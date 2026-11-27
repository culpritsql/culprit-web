use crate::{
    access::Access,
    archives::WebState,
    auth::Failure,
    metadata::{Bookmark, SavedView, StoreError},
};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header},
    routing::get,
};

pub fn routes() -> Router<WebState> {
    Router::new()
        .route("/api/workspace/saved", get(list).post(save))
        .route("/api/workspace/saved/{id}", axum::routing::delete(remove))
}
pub fn storage_error(error: StoreError) -> Failure {
    match error {
        StoreError::Unavailable => (
            StatusCode::SERVICE_UNAVAILABLE,
            "Workspace storage is unavailable.",
        ),
        StoreError::Limit => (
            StatusCode::CONFLICT,
            "The saved investigation limit was reached.",
        ),
    }
}
fn authorize_write(state: &WebState, headers: &HeaderMap) -> Result<Access, Failure> {
    let access = state.access(headers)?;
    if headers.get(header::ORIGIN).and_then(|v| v.to_str().ok())
        != Some(&state.auth.config.public_url.origin().ascii_serialization())
    {
        return Err((StatusCode::FORBIDDEN, "Invalid request origin."));
    }
    Ok(access)
}
async fn list(
    State(state): State<WebState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Bookmark>>, Failure> {
    let access = state.access(&headers)?;
    let mut bookmarks = state
        .metadata()?
        .list(access.actor.clone())
        .await
        .map_err(storage_error)?;
    bookmarks.retain(|bookmark| state.allows_view(&access, &bookmark.view));
    Ok(Json(bookmarks))
}
async fn save(
    State(state): State<WebState>,
    headers: HeaderMap,
    Json(view): Json<SavedView>,
) -> Result<StatusCode, Failure> {
    let access = authorize_write(&state, &headers)?;
    if !view.valid() {
        return Err((StatusCode::BAD_REQUEST, "Invalid investigation."));
    }
    if !state.allows_view(&access, &view) {
        return Err((
            StatusCode::FORBIDDEN,
            "This investigation is outside your access.",
        ));
    }
    state
        .metadata()?
        .save(access.actor, view)
        .await
        .map_err(storage_error)?;
    Ok(StatusCode::NO_CONTENT)
}
async fn remove(
    State(state): State<WebState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<StatusCode, Failure> {
    let access = authorize_write(&state, &headers)?;
    state
        .metadata()?
        .remove(access.actor, id)
        .await
        .map_err(storage_error)?;
    Ok(StatusCode::NO_CONTENT)
}
