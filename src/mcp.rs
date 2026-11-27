use crate::{access::Access, archives::WebState};
use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::post,
};
use culprit_core::PublishedResourceSelector;
use culprit_read::cancellation::CollectionCancellation;
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;

const PROTOCOL_VERSION: &str = "2025-03-26";

#[derive(Deserialize)]
struct JsonRpcRequest {
    #[allow(dead_code)]
    jsonrpc: Option<String>,
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Value,
}

struct CancelOnDrop(CollectionCancellation);
impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.cancel();
    }
}

pub fn routes() -> Router<WebState> {
    Router::new().route("/mcp", post(handle_mcp))
}

fn rpc_ok(id: Value, result: Value) -> Response {
    Json(json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result
    }))
    .into_response()
}

fn rpc_error(id: Value, code: i64, message: &str) -> Response {
    Json(json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": code,
            "message": message
        }
    }))
    .into_response()
}

fn tool_error(id: Value, message: &str) -> Response {
    rpc_ok(
        id,
        json!({
            "isError": true,
            "content": [{ "type": "text", "text": message }]
        }),
    )
}

fn unauthorized_mcp(state: &WebState, message: &'static str) -> Box<Response> {
    let metadata_url = state
        .auth
        .config
        .public_url
        .join(".well-known/oauth-protected-resource")
        .map(|u| u.to_string())
        .unwrap_or_else(|_| "/.well-known/oauth-protected-resource".into());
    let challenge = format!("Bearer resource_metadata=\"{metadata_url}\"");
    Box::new(
        (
            StatusCode::UNAUTHORIZED,
            [(header::WWW_AUTHENTICATE, challenge)],
            Json(json!({ "error": "unauthorized", "message": message })),
        )
            .into_response(),
    )
}

async fn resolve_mcp_access(
    state: &WebState,
    headers: &HeaderMap,
) -> Result<Access, Box<Response>> {
    if let Some(auth_header) = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
    {
        let Some(token) = auth_header
            .strip_prefix("Bearer ")
            .or_else(|| auth_header.strip_prefix("bearer "))
        else {
            return Err(unauthorized_mcp(state, "Expected Bearer token."));
        };
        return match state.auth.verify_bearer(token).await {
            Ok(access) => Ok(access),
            Err((StatusCode::UNAUTHORIZED, msg)) => Err(unauthorized_mcp(state, msg)),
            Err((code, msg)) => Err(Box::new(
                (code, Json(json!({ "message": msg }))).into_response(),
            )),
        };
    }

    // Same-origin browser playground fallback using active session cookie + strict Origin check.
    if state.auth.same_origin(headers)
        && let Some(access) = state.auth.access(headers)
    {
        return Ok(access);
    }

    Err(unauthorized_mcp(
        state,
        "Authenticate with a Microsoft Entra ID / OIDC Bearer token.",
    ))
}

pub fn tool_definitions() -> Value {
    json!([
        {
            "name": "list_archives",
            "description": "List authorized Culprit regional scale units / archives, regions, and your RBAC permissions.",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }
        },
        {
            "name": "fleet_overview",
            "description": "Query database health, active incidents, high-severity findings, CPU/Memory telemetry, and unreachable collector targets in an archive.",
            "inputSchema": {
                "type": "object",
                "required": ["archive"],
                "properties": {
                    "archive": { "type": "string", "description": "Archive / scale unit name from list_archives." },
                    "as_of": { "type": "string", "description": "Optional RFC3339 UTC cutoff (defaults to now)." },
                    "attention_only": { "type": "boolean", "description": "Filter to databases with active incidents, high findings, or stale coverage." },
                    "environment": { "type": "string" },
                    "engine": { "type": "string", "enum": ["mssql", "postgres", "mysql", "yugabyte", "sqlite"] },
                    "sort": { "type": "string", "enum": ["attention", "resource"] },
                    "page_rows": { "type": "integer", "minimum": 1, "maximum": 100 }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "investigate_incident",
            "description": "Inspect root cause, blocking owner, victim SQL, recommended developer action, and verification steps for a database around a UTC timestamp.",
            "inputSchema": {
                "type": "object",
                "required": ["archive", "namespace_id", "database", "around"],
                "properties": {
                    "archive": { "type": "string" },
                    "namespace_id": { "type": "string", "description": "64-hex namespace selector from fleet_overview." },
                    "database": { "type": "string", "description": "64-hex database selector from fleet_overview." },
                    "around": { "type": "string", "description": "RFC3339 UTC timestamp around the incident." }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "query_database_window",
            "description": "Read archived Top SQL workload + CPU/Memory/Waits/Blocking/Deadlocks ('compatible-workload') or ranked Schema/Index & Operational findings + Fix SQL ('published-answers') for a UTC time window.",
            "inputSchema": {
                "type": "object",
                "required": ["archive", "namespace_id", "database", "from", "until"],
                "properties": {
                    "archive": { "type": "string" },
                    "namespace_id": { "type": "string" },
                    "database": { "type": "string" },
                    "from": { "type": "string", "description": "RFC3339 UTC start timestamp." },
                    "until": { "type": "string", "description": "RFC3339 UTC end timestamp." },
                    "as_of": { "type": "string", "description": "Optional RFC3339 UTC publication cutoff (defaults to until)." },
                    "view": { "type": "string", "enum": ["compatible-workload", "published-answers"], "default": "compatible-workload" },
                    "page_rows": { "type": "integer", "minimum": 1, "maximum": 50 }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "diff_execution_plans",
            "description": "Parse and compare two native execution plans (SQL Server Showplan XML, PostgreSQL EXPLAIN JSON/text, MySQL JSON) and explain operator & cost regressions.",
            "inputSchema": {
                "type": "object",
                "required": ["plan_a_text", "plan_b_text"],
                "properties": {
                    "plan_a_text": { "type": "string", "description": "Baseline native execution plan text/XML/JSON." },
                    "plan_b_text": { "type": "string", "description": "Comparison native execution plan text/XML/JSON." },
                    "name_a": { "type": "string" },
                    "name_b": { "type": "string" }
                },
                "additionalProperties": false
            }
        }
    ])
}

async fn audit_mcp(
    state: &WebState,
    access: &Access,
    operation: &'static str,
    archive: Option<String>,
    resource: Option<PublishedResourceSelector>,
    allowed: bool,
) -> Result<(), Box<Response>> {
    if let Some(store) = &state.metadata {
        store
            .audit(
                access.actor.clone(),
                operation,
                archive,
                resource.filter(|r| r.validate().is_ok()),
                if allowed { "allowed" } else { "denied" },
            )
            .await
            .map_err(|_| {
                Box::new(
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({ "message": "Audit write failed." })),
                    )
                        .into_response(),
                )
            })?;
    }
    Ok(())
}

async fn handle_mcp(
    State(state): State<WebState>,
    headers: HeaderMap,
    Json(req): Json<JsonRpcRequest>,
) -> Response {
    let access = match resolve_mcp_access(&state, &headers).await {
        Ok(access) => access,
        Err(resp) => return *resp,
    };

    // JSON-RPC notifications carry no `id` and expect 202 Accepted.
    let Some(id) = req.id else {
        return StatusCode::ACCEPTED.into_response();
    };

    match req.method.as_str() {
        "initialize" => rpc_ok(
            id,
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": { "tools": {} },
                "serverInfo": {
                    "name": "culprit-web-mcp",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "instructions": "Read-only database fleet investigation server backed by verified Culprit warehouse archives. Every call enforces the caller's Microsoft Entra ID / OIDC RBAC grants."
            }),
        ),
        "ping" => rpc_ok(id, json!({})),
        "tools/list" => rpc_ok(id, json!({ "tools": tool_definitions() })),
        "tools/call" => dispatch_tool_call(&state, &access, id, &req.params).await,
        _ => rpc_error(id, -32601, "Method not found."),
    }
}

async fn dispatch_tool_call(
    state: &WebState,
    access: &Access,
    id: Value,
    params: &Value,
) -> Response {
    let Some(tool_name) = params.get("name").and_then(Value::as_str) else {
        return rpc_error(id, -32602, "Missing tool name.");
    };
    let args = params
        .get("arguments")
        .filter(|v| v.is_object())
        .cloned()
        .unwrap_or_else(|| json!({}));

    match tool_name {
        "list_archives" => {
            let regions: BTreeMap<_, _> = state
                .auth
                .config
                .archives
                .iter()
                .filter_map(|a| a.region.as_ref().map(|r| (a.name.as_str(), r.as_str())))
                .collect();
            let list: Vec<Value> = access
                .archives
                .iter()
                .filter_map(|(name, grant)| {
                    let arch = state.directory.archives.get(name)?;
                    Some(json!({
                        "archive": name,
                        "revision": arch.info.reference.revision,
                        "region": regions.get(name.as_str()),
                        "view_fleet": grant.view_fleet,
                        "inspect_evidence": grant.inspect_evidence,
                        "export_evidence": grant.export_evidence,
                        "assigned_resources": grant.resources
                    }))
                })
                .collect();
            let text = serde_json::to_string_pretty(&list).unwrap_or_else(|_| "[]".into());
            rpc_ok(id, json!({ "content": [{ "type": "text", "text": text }] }))
        }
        "fleet_overview" => {
            let Some(archive_name) = args.get("archive").and_then(Value::as_str) else {
                return tool_error(id, "Missing required argument 'archive'.");
            };
            let allowed = access
                .archives
                .get(archive_name)
                .is_some_and(|g| g.view_fleet);
            let archive = state.directory.archives.get(archive_name);
            if let Err(resp) = audit_mcp(
                state,
                access,
                "mcp:fleet_overview",
                archive.map(|a| a.info.reference.name.clone()),
                None,
                allowed && archive.is_some(),
            )
            .await
            {
                return *resp;
            }
            let (true, Some(archive)) = (allowed, archive) else {
                return tool_error(
                    id,
                    "Access denied: your identity does not hold fleet view permission for this archive.",
                );
            };
            let Ok(_slot) = state.directory.slots.try_acquire() else {
                return tool_error(id, "Archive concurrency limit reached; retry shortly.");
            };
            let as_of = args
                .get("as_of")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
            let payload = json!({
                "connection": archive.info.reference,
                "request": {
                    "as_of": as_of,
                    "window": null,
                    "max_age_seconds": 3600,
                    "page_rows": args.get("page_rows").and_then(Value::as_u64).unwrap_or(24).clamp(1, 100),
                    "after": null,
                    "sort": args.get("sort").and_then(Value::as_str).unwrap_or("attention"),
                    "filter": {
                        "environment": args.get("environment").and_then(Value::as_str),
                        "engine": args.get("engine").and_then(Value::as_str),
                        "attention_only": args.get("attention_only").and_then(Value::as_bool).unwrap_or(false),
                        "shared_group": null
                    }
                }
            });
            run_archive_dispatch(id, archive, "/api/archive/fleet", &payload).await
        }
        "investigate_incident" => {
            let (Some(archive_name), Some(ns), Some(db), Some(around)) = (
                args.get("archive").and_then(Value::as_str),
                args.get("namespace_id").and_then(Value::as_str),
                args.get("database").and_then(Value::as_str),
                args.get("around").and_then(Value::as_str),
            ) else {
                return tool_error(
                    id,
                    "Missing required arguments: archive, namespace_id, database, around.",
                );
            };
            let Ok(selector) = serde_json::from_value::<PublishedResourceSelector>(json!({
                "namespace_id": ns,
                "database": db,
            })) else {
                return tool_error(id, "Invalid 64-hex namespace_id or database selector.");
            };
            if selector.validate().is_err() {
                return tool_error(id, "Invalid 64-hex namespace_id or database selector.");
            }
            let allowed = access
                .archives
                .get(archive_name)
                .is_some_and(|g| g.may_inspect(&selector));
            let archive = state.directory.archives.get(archive_name);
            if let Err(resp) = audit_mcp(
                state,
                access,
                "mcp:investigate_incident",
                archive.map(|a| a.info.reference.name.clone()),
                Some(selector.clone()),
                allowed && archive.is_some(),
            )
            .await
            {
                return *resp;
            }
            let (true, Some(archive)) = (allowed, archive) else {
                return tool_error(
                    id,
                    "Access denied: inspect_evidence permission is required for this database.",
                );
            };
            let Ok(_slot) = state.directory.slots.try_acquire() else {
                return tool_error(id, "Archive concurrency limit reached; retry shortly.");
            };
            let payload = json!({
                "connection": archive.info.reference,
                "resource": selector,
                "around": around
            });
            run_archive_dispatch(id, archive, "/api/archive/incident", &payload).await
        }
        "query_database_window" => {
            let (Some(archive_name), Some(ns), Some(db), Some(from), Some(until)) = (
                args.get("archive").and_then(Value::as_str),
                args.get("namespace_id").and_then(Value::as_str),
                args.get("database").and_then(Value::as_str),
                args.get("from").and_then(Value::as_str),
                args.get("until").and_then(Value::as_str),
            ) else {
                return tool_error(
                    id,
                    "Missing required arguments: archive, namespace_id, database, from, until.",
                );
            };
            let Ok(selector) = serde_json::from_value::<PublishedResourceSelector>(json!({
                "namespace_id": ns,
                "database": db,
            })) else {
                return tool_error(id, "Invalid 64-hex namespace_id or database selector.");
            };
            if selector.validate().is_err() {
                return tool_error(id, "Invalid 64-hex namespace_id or database selector.");
            }
            let allowed = access
                .archives
                .get(archive_name)
                .is_some_and(|g| g.may_inspect(&selector));
            let archive = state.directory.archives.get(archive_name);
            if let Err(resp) = audit_mcp(
                state,
                access,
                "mcp:query_database_window",
                archive.map(|a| a.info.reference.name.clone()),
                Some(selector.clone()),
                allowed && archive.is_some(),
            )
            .await
            {
                return *resp;
            }
            let (true, Some(archive)) = (allowed, archive) else {
                return tool_error(
                    id,
                    "Access denied: inspect_evidence permission is required for this database.",
                );
            };
            let Ok(_slot) = state.directory.slots.try_acquire() else {
                return tool_error(id, "Archive concurrency limit reached; retry shortly.");
            };
            let as_of = args.get("as_of").and_then(Value::as_str).unwrap_or(until);
            let view = args
                .get("view")
                .and_then(Value::as_str)
                .unwrap_or("compatible-workload");
            let payload = json!({
                "connection": archive.info.reference,
                "request": {
                    "resource": selector,
                    "window": { "from": from, "until": until },
                    "as_of": as_of,
                    "view": view,
                    "page_rows": args.get("page_rows").and_then(Value::as_u64).unwrap_or(8).clamp(1, 50),
                    "after": null
                }
            });
            run_archive_dispatch(id, archive, "/api/archive/window", &payload).await
        }
        "diff_execution_plans" => {
            if !access.archives.values().any(|g| g.has_inspection_grant()) {
                return tool_error(
                    id,
                    "Access denied: inspect_evidence permission is required to parse or diff plans.",
                );
            }
            let (Some(plan_a_text), Some(plan_b_text)) = (
                args.get("plan_a_text").and_then(Value::as_str),
                args.get("plan_b_text").and_then(Value::as_str),
            ) else {
                return tool_error(id, "Missing plan_a_text or plan_b_text.");
            };
            let Ok(_slot) = state.directory.slots.try_acquire() else {
                return tool_error(id, "Archive concurrency limit reached; retry shortly.");
            };
            let Some(archive) = state.directory.archives.values().next() else {
                return tool_error(id, "No archive available.");
            };
            let owner = CancelOnDrop(CollectionCancellation::default());
            let headers = BTreeMap::new();
            let p_a = archive
                .reader
                .dispatch(
                    "POST",
                    "/api/plans/parse",
                    &headers,
                    &serde_json::to_vec(&json!({ "text": plan_a_text })).unwrap_or_default(),
                    &owner.0,
                )
                .await;
            if p_a.status != 200 {
                return tool_error(id, &String::from_utf8_lossy(&p_a.body));
            }
            let p_b = archive
                .reader
                .dispatch(
                    "POST",
                    "/api/plans/parse",
                    &headers,
                    &serde_json::to_vec(&json!({ "text": plan_b_text })).unwrap_or_default(),
                    &owner.0,
                )
                .await;
            if p_b.status != 200 {
                return tool_error(id, &String::from_utf8_lossy(&p_b.body));
            }
            let Ok(val_a) = serde_json::from_slice::<Value>(&p_a.body) else {
                return tool_error(id, "Could not decode parsed baseline plan.");
            };
            let Ok(val_b) = serde_json::from_slice::<Value>(&p_b.body) else {
                return tool_error(id, "Could not decode parsed comparison plan.");
            };
            let diff_payload = json!({
                "a": val_a,
                "b": val_b,
                "nameA": args.get("name_a").and_then(Value::as_str).unwrap_or("Baseline plan"),
                "nameB": args.get("name_b").and_then(Value::as_str).unwrap_or("Comparison plan")
            });
            run_archive_dispatch(id, archive, "/api/plans/diff", &diff_payload).await
        }
        _ => rpc_error(id, -32602, "Unknown MCP tool."),
    }
}

async fn run_archive_dispatch(
    id: Value,
    archive: &crate::archives::Archive,
    path: &str,
    payload: &Value,
) -> Response {
    let Ok(bytes) = serde_json::to_vec(payload) else {
        return tool_error(id, "Failed to encode archive request.");
    };
    let owner = CancelOnDrop(CollectionCancellation::default());
    let forwarded = BTreeMap::new();
    let res = archive
        .reader
        .dispatch("POST", path, &forwarded, &bytes, &owner.0)
        .await;
    let body_text = String::from_utf8_lossy(&res.body).into_owned();
    if res.status >= 400 {
        return tool_error(id, &body_text);
    }
    rpc_ok(
        id,
        json!({
            "content": [{ "type": "text", "text": body_text }]
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mcp_tool_catalog_exposes_five_typed_tools() {
        let defs = tool_definitions();
        let arr = defs.as_array().expect("tools array");
        assert_eq!(arr.len(), 5);
        let names: Vec<&str> = arr
            .iter()
            .filter_map(|t| t.get("name").and_then(Value::as_str))
            .collect();
        assert_eq!(
            names,
            vec![
                "list_archives",
                "fleet_overview",
                "investigate_incident",
                "query_database_window",
                "diff_execution_plans"
            ]
        );
    }
}
