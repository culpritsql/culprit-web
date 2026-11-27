use crate::{access::Access, auth::Failure, config::ArchiveConfig};
use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use culprit_archive_web::{ArchiveWebApp, MAX_CONCURRENT_REQUESTS, MAX_HTTP_BODY_BYTES};
use culprit_core::{PublishedResourceSelector, WarehouseConnectionInfo, WarehouseConnectionRef};
use culprit_engine::evidence::{EvidenceConfig, EvidenceRuntime};
use culprit_read::cancellation::CollectionCancellation;
use serde::Deserialize;
use std::{collections::BTreeMap, sync::Arc};
use tokio::sync::Semaphore;

struct Archive {
    info: WarehouseConnectionInfo,
    reader: ArchiveWebApp,
}
pub struct ArchiveDirectory {
    archives: BTreeMap<String, Archive>,
    slots: Semaphore,
}

impl ArchiveDirectory {
    pub fn open(configs: &[ArchiveConfig]) -> Result<Self, Box<dyn std::error::Error>> {
        let mut archives = BTreeMap::new();
        let runtime = EvidenceRuntime::default();
        for config in configs {
            let evidence = EvidenceConfig::from_file(&config.evidence_config)?;
            let info = ArchiveWebApp::connection_info_from_config(&config.name, &evidence)?;
            let service = Arc::new(runtime.evidence(&evidence)?);
            let reader = ArchiveWebApp::new(info.clone(), service.clone(), service, None, None);
            archives.insert(config.name.clone(), Archive { info, reader });
        }
        Ok(Self {
            archives,
            slots: Semaphore::new(MAX_CONCURRENT_REQUESTS),
        })
    }
}

#[derive(Clone)]
struct WebState {
    directory: Arc<ArchiveDirectory>,
    auth: Arc<crate::auth::Auth>,
}

impl WebState {
    fn access(&self, headers: &HeaderMap) -> Result<Access, Failure> {
        self.auth
            .access(headers)
            .ok_or((StatusCode::UNAUTHORIZED, "Sign in to view this archive."))
    }
}

pub fn routes(directory: ArchiveDirectory, auth: Arc<crate::auth::Auth>) -> Router {
    Router::new()
        .route("/api/archive/connections", get(connections))
        .route("/api/archive/{operation}", post(read))
        .layer(DefaultBodyLimit::max(MAX_HTTP_BODY_BYTES))
        .with_state(WebState {
            directory: Arc::new(directory),
            auth,
        })
}

async fn connections(
    State(state): State<WebState>,
    headers: HeaderMap,
) -> Result<Json<Vec<WarehouseConnectionInfo>>, Failure> {
    let access = state.access(&headers)?;
    Ok(Json(
        access
            .archives
            .keys()
            .filter_map(|name| state.directory.archives.get(name).map(|a| a.info.clone()))
            .collect(),
    ))
}

#[derive(Deserialize)]
struct Connection {
    connection: WarehouseConnectionRef,
}
#[derive(Deserialize)]
struct Resource {
    resource: PublishedResourceSelector,
}
#[derive(Deserialize)]
struct ResourceRequest {
    request: Resource,
}

const DENIED: Failure = (
    StatusCode::FORBIDDEN,
    "You do not have access to this archive or resource.",
);
const INVALID: Failure = (StatusCode::BAD_REQUEST, "Invalid archive request.");
struct ReadGuard(CollectionCancellation);
impl Drop for ReadGuard {
    fn drop(&mut self) {
        self.0.cancel();
    }
}

async fn read(
    State(state): State<WebState>,
    Path(operation): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, Failure> {
    let access = state.access(&headers)?;
    let scoped = match operation.as_str() {
        "fleet" => false,
        "incident" | "artifacts" | "window" => true,
        _ => return Err((StatusCode::NOT_FOUND, "Unknown archive route.")),
    };
    if scoped
        && !access
            .archives
            .values()
            .any(|grant| grant.has_inspection_grant())
    {
        return Err(DENIED);
    }
    let envelope: Connection = serde_json::from_slice(&body).map_err(|_| INVALID)?;
    let grant = access
        .archives
        .get(&envelope.connection.name)
        .ok_or(DENIED)?;
    if scoped {
        let selected = if operation == "incident" {
            serde_json::from_slice::<Resource>(&body).map_err(|_| INVALID)?
        } else {
            serde_json::from_slice::<ResourceRequest>(&body)
                .map_err(|_| INVALID)?
                .request
        };
        if !grant.may_inspect(&selected.resource) {
            return Err(DENIED);
        }
    } else if !grant.view_fleet {
        return Err(DENIED);
    }
    let archive = state
        .directory
        .archives
        .get(&envelope.connection.name)
        .ok_or(DENIED)?;
    let _slot = state
        .directory
        .slots
        .try_acquire()
        .map_err(|_| (StatusCode::SERVICE_UNAVAILABLE, "Archive is busy."))?;
    let owner = ReadGuard(CollectionCancellation::default());
    let mut forwarded = BTreeMap::new();
    if let Some(language) = headers.get("x-culprit-lang").and_then(|v| v.to_str().ok()) {
        forwarded.insert("x-culprit-lang".into(), language.into());
    }
    let result = archive
        .reader
        .dispatch(
            "POST",
            &format!("/api/archive/{operation}"),
            &forwarded,
            &body,
            &owner.0,
        )
        .await;
    Ok((
        StatusCode::from_u16(result.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
        [(header::CONTENT_TYPE, result.content_type)],
        result.body,
    )
        .into_response())
}
