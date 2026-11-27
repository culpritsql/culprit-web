use crate::{
    access::{Access, Actor},
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
const METADATA_CACHE_SECONDS: u64 = 900;
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
    metadata_cache: Expiring<CoreProviderMetadata>,
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
            metadata_cache: Expiring::default(),
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
    async fn discover_metadata(
        &self,
        provider: &Provider,
    ) -> Result<CoreProviderMetadata, Failure> {
        if let Some(cached) = self.metadata_cache.get(&provider.id) {
            return Ok(cached);
        }
        let discovered = CoreProviderMetadata::discover_async(
            IssuerUrl::new(provider.issuer.clone()).map_err(|_| IDP_ERROR)?,
            &self.http,
        )
        .await
        .map_err(|_| IDP_ERROR)?;
        let _ = self.metadata_cache.insert(
            provider.id.clone(),
            discovered.clone(),
            Duration::from_secs(METADATA_CACHE_SECONDS),
        );
        Ok(discovered)
    }
    async fn client(&self, provider: &Provider) -> Result<DiscoveredClient, Failure> {
        let metadata = self.discover_metadata(provider).await?;
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
    pub fn same_origin(&self, headers: &HeaderMap) -> bool {
        let expected = self.config.public_url.origin().ascii_serialization();
        headers
            .get(header::ORIGIN)
            .and_then(|h| h.to_str().ok())
            .is_some_and(|origin| origin == expected)
    }
    /// Verifies an OIDC / Microsoft Entra ID Bearer JWT against configured providers' JWKS
    /// and maps its verified claims through the exact same `Access::from_claims` grants.
    pub async fn verify_bearer(&self, raw_token: &str) -> Result<Access, Failure> {
        let token: GrantToken = raw_token.trim().parse().map_err(|_| INVALID)?;
        let mut any_idp_error = false;
        for provider in &self.config.auth.providers {
            let metadata = match self.discover_metadata(provider).await {
                Ok(m) => m,
                Err(_) => {
                    any_idp_error = true;
                    continue;
                }
            };
            let api_aud = format!("api://{}", provider.client_id);
            let client = CoreClient::from_provider_metadata(
                metadata,
                ClientId::new(provider.client_id.clone()),
                None,
            );
            let verifier = client
                .id_token_verifier()
                .set_other_audience_verifier_fn(|aud| aud.as_str() == api_aud);
            let Ok(identity) = token.claims(&verifier, |_: Option<&Nonce>| Ok(())) else {
                continue;
            };
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|_| INVALID)?
                .as_secs();
            if (identity.expiration().timestamp().max(0) as u64) <= now {
                return Err(INVALID);
            }
            return Access::from_claims(
                &provider.id,
                Actor {
                    issuer: identity.issuer().as_str().to_owned(),
                    subject: identity.subject().as_str().to_owned(),
                },
                &identity.additional_claims().0,
                &self.config.auth.grants,
            )
            .ok_or((
                StatusCode::FORBIDDEN,
                "Ask your administrator for access to this archive.",
            ));
        }
        if any_idp_error {
            Err(IDP_ERROR)
        } else {
            Err(INVALID)
        }
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

/// RFC 9728 OAuth 2.0 Protected Resource Metadata for MCP coding-agent discovery.
pub async fn oauth_protected_resource(State(auth): State<Arc<Auth>>) -> Json<Value> {
    let resource = auth
        .config
        .public_url
        .join("mcp")
        .map(|u| u.to_string())
        .unwrap_or_else(|_| "/mcp".into());
    let authorization_servers: Vec<&str> = auth
        .config
        .auth
        .providers
        .iter()
        .map(|p| p.issuer.as_str())
        .collect();
    let mut scopes = vec!["openid".to_string(), "profile".to_string()];
    for p in &auth.config.auth.providers {
        for s in &p.scopes {
            if !scopes.contains(s) {
                scopes.push(s.clone());
            }
        }
        let entra_scope = format!("api://{}/.default", p.client_id);
        if !scopes.contains(&entra_scope) {
            scopes.push(entra_scope);
        }
    }
    Json(json!({
        "resource": resource,
        "authorization_servers": authorization_servers,
        "bearer_methods_supported": ["header"],
        "scopes_supported": scopes,
        "resource_name": "Culprit Fleet Archive MCP"
    }))
}

pub async fn session(State(auth): State<Arc<Auth>>, headers: HeaderMap) -> Json<Value> {
    let providers: Vec<_> = auth
        .config
        .auth
        .providers
        .iter()
        .map(|p| json!({"id":p.id,"label":p.label,"issuer":p.issuer,"client_id":p.client_id}))
        .collect();
    let access = auth.access(&headers);
    let regions: std::collections::BTreeMap<_, _> = auth
        .config
        .archives
        .iter()
        .filter(|archive| {
            access
                .as_ref()
                .is_some_and(|scope| scope.archives.contains_key(&archive.name))
        })
        .filter_map(|archive| {
            archive
                .region
                .as_ref()
                .map(|region| (&archive.name, region))
        })
        .collect();
    Json(json!({
        "regions":regions, "saved_views_enabled":auth.config.metadata_db.is_some(),"access":access, "providers":providers,
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
    // Accept only bounded, same-origin app paths (never protocol-relative, auth, or API paths).
    let return_to = params
        .return_to
        .filter(|s| {
            s.len() <= 4096
                && s.starts_with('/')
                && !s.starts_with("//")
                && !s.starts_with("/auth/")
                && !s.starts_with("/api/")
                && !s.chars().any(|c| c.is_control() || c == '\\')
        })
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
        Actor {
            issuer: identity.issuer().as_str().to_owned(),
            subject: identity.subject().as_str().to_owned(),
        },
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
    if !auth.same_origin(&headers) {
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
