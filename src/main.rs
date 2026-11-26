mod auth;
mod config;
mod session;

use auth::{Auth, Failure};
use axum::{
    Router,
    body::Bytes,
    extract::{DefaultBodyLimit, OriginalUri, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use culprit_archive_web::{ArchiveWebApp, MAX_CONCURRENT_REQUESTS, MAX_HTTP_BODY_BYTES};
use culprit_engine::evidence::{EvidenceConfig, EvidenceRuntime};
use culprit_read::cancellation::CollectionCancellation;
use std::{collections::BTreeMap, env, fs, sync::Arc};
use tokio::{net::TcpListener, sync::Semaphore};
use tower_http::services::ServeDir;

#[derive(Clone)]
struct App {
    auth: Arc<Auth>,
    archive: Arc<ArchiveWebApp>,
    slots: Arc<Semaphore>,
}

struct ReadGuard(CollectionCancellation);
impl Drop for ReadGuard {
    fn drop(&mut self) {
        self.0.cancel();
    }
}

async fn archive(
    State(app): State<App>,
    uri: OriginalUri,
    method: Method,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, Failure> {
    let access = app
        .auth
        .access(&headers)
        .ok_or((StatusCode::UNAUTHORIZED, "Sign in to view this archive."))?;
    match (method.as_str(), uri.path()) {
        ("GET", "/api/archive/connections") | ("POST", "/api/archive/fleet") => {}
        ("POST", "/api/archive/incident" | "/api/archive/artifacts" | "/api/archive/window")
            if access.inspect_evidence => {}
        ("POST", "/api/archive/incident" | "/api/archive/artifacts" | "/api/archive/window") => {
            return Err((StatusCode::FORBIDDEN, "Evidence access is required."));
        }
        _ => return Err((StatusCode::NOT_FOUND, "Unknown archive route.")),
    }
    let _slot = app
        .slots
        .try_acquire()
        .map_err(|_| (StatusCode::SERVICE_UNAVAILABLE, "Archive is busy."))?;
    let guard = ReadGuard(CollectionCancellation::default());
    let mut forwarded = BTreeMap::new();
    if let Some(language) = headers.get("x-culprit-lang").and_then(|h| h.to_str().ok()) {
        forwarded.insert("x-culprit-lang".into(), language.into());
    }
    let result = app
        .archive
        .dispatch(method.as_str(), uri.path(), &forwarded, &body, &guard.0)
        .await;
    let status = StatusCode::from_u16(result.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    Ok((
        status,
        [(header::CONTENT_TYPE, result.content_type)],
        result.body,
    )
        .into_response())
}

async fn private_response(req: axum::extract::Request, next: Next) -> Response {
    let mut res = next.run(req).await;
    res.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    res.headers_mut().insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    res
}

async fn shutdown() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        if let Ok(mut terminate) = signal(SignalKind::terminate()) {
            tokio::select! {
                _ = terminate.recv() => {},
                _ = tokio::signal::ctrl_c() => {},
            }
            return;
        }
    }
    let _ = tokio::signal::ctrl_c().await;
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config_path = env::args_os()
        .nth(1)
        .ok_or("usage: culprit-web WEB_CONFIG.json")?;
    let config: config::Config = serde_json::from_slice(&fs::read(config_path)?)?;
    config.validate()?;
    let evidence = EvidenceConfig::from_file(&config.evidence_config)?;
    let connection = ArchiveWebApp::connection_info_from_config(&config.archive_name, &evidence)?;
    let reader = Arc::new(EvidenceRuntime::default().evidence(&evidence)?);
    let archive_app = ArchiveWebApp::new(connection, reader.clone(), reader, None, None);
    let auth = Arc::new(Auth::new(config)?);
    let api = Router::new()
        .route("/api/archive/{operation}", get(archive).post(archive))
        .layer(DefaultBodyLimit::max(MAX_HTTP_BODY_BYTES))
        .with_state(App {
            auth: auth.clone(),
            archive: Arc::new(archive_app),
            slots: Arc::new(Semaphore::new(MAX_CONCURRENT_REQUESTS)),
        });
    let routes = Router::new()
        .route("/api/session", get(auth::session))
        .route("/auth/login/{id}", get(auth::login))
        .route("/auth/callback/{id}", get(auth::callback))
        .route("/auth/logout", post(auth::logout))
        .with_state(auth)
        .merge(api)
        .layer(middleware::from_fn(private_response))
        .route("/healthz", get(|| async { "ok" }))
        .fallback_service(ServeDir::new("dist"));
    let bind = env::var("CULPRIT_WEB_BIND").unwrap_or_else(|_| "127.0.0.1:8080".into());
    let listener = TcpListener::bind(&bind).await?;
    eprintln!("Culprit web listening on {}", listener.local_addr()?);
    axum::serve(listener, routes)
        .with_graceful_shutdown(shutdown())
        .await?;
    Ok(())
}
