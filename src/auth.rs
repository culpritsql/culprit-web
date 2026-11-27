use crate::{
    access::Access,
    config::{Config, Provider},
    session::Expiring,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Redirect, Response},
};

use openidconnect::{
    AdditionalClaims, AuthorizationCode, ClientId, ClientSecret, CsrfToken, EndpointMaybeSet,
    EndpointNotSet, EndpointSet, IdToken, IssuerUrl, Nonce, PkceCodeChallenge, PkceCodeVerifier,
    RedirectUrl, Scope, TokenResponse,
    core::{
        CoreAuthenticationFlow, CoreClient, CoreGenderClaim, CoreJweContentEncryptionAlgorithm,
        CoreJwsSigningAlgorithm, CoreProviderMetadata,
    },
    reqwest,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

type DiscoveredClient = CoreClient<
    EndpointSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointMaybeSet,
    EndpointMaybeSet,
>;
#[derive(Debug, Serialize, Deserialize)]
#[serde(transparent)]
struct GrantClaims(std::collections::BTreeMap<String, Value>);
impl AdditionalClaims for GrantClaims {}
type GrantToken = IdToken<
    GrantClaims,
    CoreGenderClaim,
    CoreJweContentEncryptionAlgorithm,
    CoreJwsSigningAlgorithm,
>;

pub type Failure = (StatusCode, &'static str);
const INVALID: Failure = (
    StatusCode::UNAUTHORIZED,
    "Sign-in expired or could not be verified.",
);
const IDP_ERROR: Failure = (
    StatusCode::BAD_GATEWAY,
    "The identity provider is unavailable.",
);
const BUSY: Failure = (StatusCode::SERVICE_UNAVAILABLE, "Sign-in capacity reached.");
const SESSION_SECONDS: u64 = 900;
const LOGIN_SECONDS: u64 = 300;
const LOGIN_COOKIE: &str = "culprit_login";
const SESSION_COOKIE: &str = "culprit_session";

struct Pending {
    provider: String,
    nonce: Nonce,
    verifier: PkceCodeVerifier,
    return_to: String,
}
pub struct Auth {
    pub config: Config,
    http: reqwest::Client,
    pending: Expiring<Pending>,
    sessions: Expiring<Access>,
}

impl Auth {
    pub fn new(config: Config) -> Result<Self, reqwest::Error> {
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(12))
            .build()?;
        Ok(Self {
            config,
            http,
            pending: Expiring::default(),
            sessions: Expiring::default(),
        })
    }
    fn provider(&self, id: &str) -> Result<&Provider, Failure> {
        self.config
            .auth
            .providers
            .iter()
            .find(|p| p.id == id)
            .ok_or((StatusCode::NOT_FOUND, "Unknown provider."))
    }
    async fn client(&self, provider: &Provider) -> Result<DiscoveredClient, Failure> {
        let metadata = CoreProviderMetadata::discover_async(
            IssuerUrl::new(provider.issuer.clone()).map_err(|_| IDP_ERROR)?,
            &self.http,
        )
        .await
        .map_err(|_| IDP_ERROR)?;
        let secret = tokio::fs::read_to_string(&provider.client_secret_file)
            .await
            .map_err(|_| IDP_ERROR)?;
        let callback = self
            .config
            .public_url
            .join(&format!("auth/callback/{}", provider.id))
            .map_err(|_| IDP_ERROR)?;
        Ok(CoreClient::from_provider_metadata(
            metadata,
            ClientId::new(provider.client_id.clone()),
            Some(ClientSecret::new(secret.trim_end().to_owned())),
        )
        .set_redirect_uri(RedirectUrl::new(callback.to_string()).map_err(|_| IDP_ERROR)?))
    }
    fn cookie(&self, name: &str, value: &str, seconds: u64) -> String {
        let secure = if self.config.public_url.scheme() == "https" {
            "; Secure"
        } else {
            ""
        };
        format!("{name}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={seconds}{secure}")
    }
    pub fn access(&self, headers: &HeaderMap) -> Option<Access> {
        self.sessions.get(cookie(headers, SESSION_COOKIE)?)
    }
}

fn cookie<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(key, _)| *key == name)
        .map(|(_, value)| value)
}

#[derive(Deserialize)]
pub struct Login {
    return_to: Option<String>,
}
#[derive(Deserialize)]
pub struct Callback {
    code: String,
    state: String,
}

pub async fn session(State(auth): State<Arc<Auth>>, headers: HeaderMap) -> Json<Value> {
    let providers: Vec<_> = auth
        .config
        .auth
        .providers
        .iter()
        .map(|p| json!({"id":p.id,"label":p.label}))
        .collect();
    Json(json!({
        "access":auth.access(&headers), "providers":providers,
        "read_defaults": {
            "window_page_rows": culprit_core::DEFAULT_WAREHOUSE_WINDOW_PAGE_ROWS,
            "artifact_chunk_chars": culprit_core::MAX_WAREHOUSE_ARTIFACT_CHUNK_CHARS
        }
    }))
}

pub async fn login(
    State(auth): State<Arc<Auth>>,
    Path(id): Path<String>,
    Query(params): Query<Login>,
) -> Result<Response, Failure> {
    let provider = auth.provider(&id)?;
    let client = auth.client(provider).await?;
    let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
    let request = client
        .authorize_url(
            CoreAuthenticationFlow::AuthorizationCode,
            CsrfToken::new_random,
            Nonce::new_random,
        )
        .set_pkce_challenge(challenge);
    let (url, state, nonce) = provider
        .scopes
        .iter()
        .fold(request, |request, scope| {
            request.add_scope(Scope::new(scope.clone()))
        })
        .url();
    // All web deep links live on the root with a query. Never accept another path or origin.
    let return_to = params
        .return_to
        .filter(|s| s.len() <= 4096 && s.starts_with("/?") && !s.chars().any(char::is_control))
        .unwrap_or_else(|| "/".into());
    if !auth.pending.insert(
        state.secret().clone(),
        Pending {
            provider: id,
            nonce,
            verifier,
            return_to,
        },
        Duration::from_secs(LOGIN_SECONDS),
    ) {
        return Err(BUSY);
    }
    Ok((
        [(
            header::SET_COOKIE,
            auth.cookie(LOGIN_COOKIE, state.secret(), LOGIN_SECONDS),
        )],
        Redirect::to(url.as_str()),
    )
        .into_response())
}

pub async fn callback(
    State(auth): State<Arc<Auth>>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Query(params): Query<Callback>,
) -> Result<Response, Failure> {
    if cookie(&headers, LOGIN_COOKIE) != Some(&params.state) {
        return Err(INVALID);
    }
    let flow = auth
        .pending
        .take(&params.state)
        .filter(|f| f.provider == id)
        .ok_or(INVALID)?;
    let client = auth.client(auth.provider(&id)?).await?;
    let response = client
        .exchange_code(AuthorizationCode::new(params.code))
        .map_err(|_| IDP_ERROR)?
        .set_pkce_verifier(flow.verifier)
        .request_async(&auth.http)
        .await
        .map_err(|_| INVALID)?;
    let token: GrantToken = response
        .id_token()
        .ok_or(INVALID)?
        .to_string()
        .parse()
        .map_err(|_| INVALID)?;
    let verifier = client.id_token_verifier();
    let identity = token.claims(&verifier, &flow.nonce).map_err(|_| INVALID)?;
    let access = Access::from_claims(
        &id,
        &identity.additional_claims().0,
        &auth.config.auth.grants,
    )
    .ok_or((
        StatusCode::FORBIDDEN,
        "Ask your administrator for access to this archive.",
    ))?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| INVALID)?
        .as_secs();
    let ttl = (identity.expiration().timestamp().max(0) as u64)
        .saturating_sub(now)
        .min(SESSION_SECONDS);
    if ttl == 0 {
        return Err(INVALID);
    }
    let sid = CsrfToken::new_random();
    if !auth
        .sessions
        .insert(sid.secret().clone(), access, Duration::from_secs(ttl))
    {
        return Err(BUSY);
    }
    if let Some(old) = cookie(&headers, SESSION_COOKIE) {
        auth.sessions.take(old);
    }
    let mut result = Redirect::to(&flow.return_to).into_response();
    for value in [
        auth.cookie(SESSION_COOKIE, sid.secret(), ttl),
        auth.cookie(LOGIN_COOKIE, "", 0),
    ] {
        result
            .headers_mut()
            .append(header::SET_COOKIE, value.parse().map_err(|_| INVALID)?);
    }
    Ok(result)
}

pub async fn logout(
    State(auth): State<Arc<Auth>>,
    headers: HeaderMap,
) -> Result<Response, Failure> {
    let origin = auth.config.public_url.origin().ascii_serialization();
    if headers.get(header::ORIGIN).and_then(|h| h.to_str().ok()) != Some(&origin) {
        return Err((StatusCode::FORBIDDEN, "Invalid request origin."));
    }
    if let Some(key) = cookie(&headers, SESSION_COOKIE) {
        auth.sessions.take(key);
    }
    Ok((
        [(header::SET_COOKIE, auth.cookie(SESSION_COOKIE, "", 0))],
        Redirect::to("/"),
    )
        .into_response())
}
