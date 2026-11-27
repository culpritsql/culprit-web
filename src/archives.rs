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

pub(crate) struct Archive {
    pub(crate) info: WarehouseConnectionInfo,
    pub(crate) reader: ArchiveWebApp,
}
pub struct ArchiveDirectory {
    pub(crate) archives: BTreeMap<String, Archive>,
    pub(crate) slots: Semaphore,
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
pub struct WebState {
    pub(crate) metadata: Option<crate::metadata::Metadata>,
    pub(crate) directory: Arc<ArchiveDirectory>,
    pub auth: Arc<crate::auth::Auth>,
}

impl WebState {
    pub fn metadata(&self) -> Result<&crate::metadata::Metadata, Failure> {
        self.metadata.as_ref().ok_or((
            StatusCode::SERVICE_UNAVAILABLE,
            "Workspace storage is not configured.",
        ))
    }
    pub fn allows_view(&self, access: &Access, view: &crate::metadata::SavedView) -> bool {
        self.directory
            .archives
            .get(&view.connection.name)
            .is_some_and(|a| a.info.reference.revision == view.connection.revision)
            && access
                .archives
                .get(&view.connection.name)
                .is_some_and(|g| g.may_inspect(&view.resource))
    }
    pub fn access(&self, headers: &HeaderMap) -> Result<Access, Failure> {
        self.auth
            .access(headers)
            .ok_or((StatusCode::UNAUTHORIZED, "Sign in to view this archive."))
    }
}

pub fn routes(
    directory: ArchiveDirectory,
    auth: Arc<crate::auth::Auth>,
    metadata: Option<crate::metadata::Metadata>,
) -> Router {
    Router::new()
        .merge(crate::bookmarks::routes())
        .merge(crate::mcp::routes())
        .route("/api/archive/connections", get(connections))
        .route("/api/archive/{operation}", post(read))
        .route("/api/plans/{operation}", post(plan_operation))
        .layer(DefaultBodyLimit::max(MAX_HTTP_BODY_BYTES))
        .with_state(WebState {
            directory: Arc::new(directory),
            metadata,
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
    let (operation, upstream) = match operation.as_str() {
        "fleet" => ("fleet", "fleet"),
        "incident" => ("incident", "incident"),
        "window" => ("window", "window"),
        "artifacts" => ("artifacts", "artifacts"),
        "export" => ("export", "artifacts"),
        _ => return Err((StatusCode::NOT_FOUND, "Unknown archive route.")),
    };
    let _slot = state
        .directory
        .slots
        .try_acquire()
        .map_err(|_| (StatusCode::SERVICE_UNAVAILABLE, "Archive is busy."))?;
    let envelope = serde_json::from_slice::<Connection>(&body);
    let archive_name = envelope.as_ref().ok().map(|e| &e.connection.name);
    let archive = archive_name.and_then(|name| state.directory.archives.get(name));
    let grant = archive_name.and_then(|name| access.archives.get(name));
    let selected = match operation {
        "fleet" => None,
        "incident" => serde_json::from_slice::<Resource>(&body)
            .ok()
            .map(|r| r.resource),
        _ => serde_json::from_slice::<ResourceRequest>(&body)
            .ok()
            .map(|r| r.request.resource),
    };
    let allowed = match (grant, selected.as_ref()) {
        (Some(grant), _) if operation == "fleet" => grant.view_fleet,
        (Some(grant), Some(resource)) if operation == "export" => grant.may_export(resource),
        (Some(grant), Some(resource)) => grant.may_inspect(resource),
        _ => false,
    };
    if let Some(store) = &state.metadata {
        store
            .audit(
                access.actor.clone(),
                operation,
                archive.map(|a| a.info.reference.name.clone()),
                selected.as_ref().filter(|r| r.validate().is_ok()).cloned(),
                if allowed { "allowed" } else { "denied" },
            )
            .await
            .map_err(crate::bookmarks::storage_error)?;
    }
    if !allowed {
        if envelope.is_err()
            && operation != "fleet"
            && !access
                .archives
                .values()
                .any(|grant| grant.has_inspection_grant())
        {
            return Err(DENIED);
        }
        if envelope.is_err() || (grant.is_some() && operation != "fleet" && selected.is_none()) {
            return Err(INVALID);
        }
        return Err(DENIED);
    }
    let archive = archive.ok_or(DENIED)?;
    let owner = ReadGuard(CollectionCancellation::default());
    let mut forwarded = BTreeMap::new();
    if let Some(language) = headers.get("x-culprit-lang").and_then(|v| v.to_str().ok()) {
        forwarded.insert("x-culprit-lang".into(), language.into());
    }
    let result = archive
        .reader
        .dispatch(
            "POST",
            &format!("/api/archive/{upstream}"),
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

async fn plan_operation(
    State(state): State<WebState>,
    Path(operation): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, Failure> {
    let access = state.access(&headers)?;
    if !matches!(
        operation.as_str(),
        "parse" | "diff" | "export-plan" | "export-diff"
    ) {
        return Err((StatusCode::NOT_FOUND, "Unknown plan route."));
    }
    if !access
        .archives
        .values()
        .any(|grant| grant.has_inspection_grant())
    {
        return Err(DENIED);
    }
    let _slot = state
        .directory
        .slots
        .try_acquire()
        .map_err(|_| (StatusCode::SERVICE_UNAVAILABLE, "Archive is busy."))?;
    let archive = state.directory.archives.values().next().ok_or(DENIED)?;
    let owner = ReadGuard(CollectionCancellation::default());
    let mut forwarded = BTreeMap::new();
    if let Some(language) = headers.get("x-culprit-lang").and_then(|v| v.to_str().ok()) {
        forwarded.insert("x-culprit-lang".into(), language.into());
    }
    let result = archive
        .reader
        .dispatch(
            "POST",
            &format!("/api/plans/{operation}"),
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
