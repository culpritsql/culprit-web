mod access;
mod archives;
mod auth;
mod bookmarks;
mod config;
mod mcp;
mod metadata;
mod session;

use axum::{
    Router,
    http::{HeaderValue, header},
    middleware::{self, Next},
    response::Response,
    routing::{get, post},
};
use std::{env, fs, sync::Arc};
use tokio::net::TcpListener;
use tower_http::services::{ServeDir, ServeFile};

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
        .ok_or("usage: culprit-fleet WEB_CONFIG.json")?;
    let config: config::Config = serde_json::from_slice(&fs::read(config_path)?)?;
    let metadata = config
        .metadata_db
        .as_deref()
        .map(metadata::Metadata::open)
        .transpose()?;
    let directory = archives::ArchiveDirectory::open(&config.archives)?;
    let auth = Arc::new(auth::Auth::new(config)?);
    let api = archives::routes(directory, auth.clone(), metadata);
    let routes = Router::new()
        .route("/api/session", get(auth::session))
        .route(
            "/.well-known/oauth-protected-resource",
            get(auth::oauth_protected_resource),
        )
        .route("/auth/login/{id}", get(auth::login))
        .route("/auth/callback/{id}", get(auth::callback))
        .route("/auth/logout", post(auth::logout))
        .with_state(auth)
        .merge(api)
        .layer(middleware::from_fn(private_response))
        .route("/healthz", get(|| async { "ok" }))
        .fallback_service(
            ServeDir::new("dist").not_found_service(ServeFile::new("dist/index.html")),
        );
    let bind = env::var("CULPRIT_FLEET_BIND")
        .or_else(|_| env::var("CULPRIT_WEB_BIND"))
        .unwrap_or_else(|_| "127.0.0.1:8080".into());
    let listener = TcpListener::bind(&bind).await?;
    eprintln!("Culprit Fleet listening on {}", listener.local_addr()?);
    axum::serve(listener, routes)
        .with_graceful_shutdown(shutdown())
        .await?;
    Ok(())
}
