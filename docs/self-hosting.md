# Self-Host Culprit Fleet

## Run with Helm (Kubernetes)

Install directly from the OCI Helm chart published to GitHub Container Registry. Create a `ConfigMap` containing `web.json` and the archive configuration files it references, a `Secret` containing your OIDC client secret, and a `PersistentVolumeClaim` for saved views and access audit history:

```sh
helm upgrade --install culprit-fleet oci://ghcr.io/culpritsql/charts/culprit-fleet \
  --set imageTag=main \
  --set config.existingConfigMap=culprit-fleet-config \
  --set existingSecret=culprit-fleet-credentials \
  --set persistence.existingClaim=culprit-fleet-state
```

On tagged `vX.Y.Z` releases, `imageTag` defaults automatically to `v<appVersion>`, or you can pin an immutable digest via `imageDigest=sha256:...` or override the full image reference via `image=REGISTRY/culprit-fleet:TAG`.

Alternatively, supply inline JSON config objects under `config.files` in a Helm values file, pass `env` Secret references for warehouse credentials, and attach a service account for AWS IRSA or Azure Workload Identity. See [Chart values](../charts/culprit-fleet/values.yaml).

## Run the Container (Docker)

Pull the published multi-arch image (`linux/amd64`, `linux/arm64`) from GitHub Container Registry:

```sh
docker run --rm -p 127.0.0.1:8080:8080 \
  -v "$PWD/runtime/config:/run/config:ro" \
  -v culprit-fleet-state:/var/lib/culprit-fleet \
  -v "$PWD/runtime/secrets:/run/secrets:ro" \
  ghcr.io/culpritsql/culprit-fleet:main
```

Place `web.json`, its referenced archive config, and the referenced OIDC secret at the mounted paths (readable by UID `65532`). `GET /healthz` reports process liveness.

## Connect Published Collector Archives

Culprit Fleet never connects to your production databases. It reads sealed diagnostic captures published by [`culprit-collector`](https://github.com/culpritsql/culprit-sql-studio/blob/main/docs/collector.md) to **ClickHouse + S3** or **Azure Data Explorer + Azure Blob**:

1. Copy [config/web.example.json](../config/web.example.json), choose an archive name, and set `evidence_config` to the mounted archive configuration file.
2. Copy the warehouse template matching your collector sink — [ClickHouse + S3](../config/archive.example.json) or [ADX + Azure Blob](../config/archive.azure.example.json) — matching `pipeline`, `shard`, database, and recovery bucket/container prefix, with read-only credentials.
3. For multi-region deployments, list all regional archives in one `web.json` ([config/web.regional.example.json](../config/web.regional.example.json)). Each archive keeps independent endpoints, credentials, and RBAC grants; an outage in one region never blocks the others.

| Archive | Evidence file under `/run/config` | Backend |
|---|---|---|
| `orders-us` | `us-clickhouse.json` | US ClickHouse + S3 |
| `orders-eu` | `eu-adx.json` | EU Azure Data Explorer + Blob |
| `orders-jp` | `jp-clickhouse.json` | JP ClickHouse + S3 |

## Configure Microsoft Entra ID / OIDC & RBAC

1. For Microsoft Entra ID, register a single-tenant **Web** application with redirect URI `https://YOUR-HOST/auth/callback/corporate`. Set `issuer`, `client_id`, and `client_secret_file` in `web.json`.
2. Define application roles (for example `Culprit.Viewer` and `Culprit.DBA`) and map them in `grants`:

| Permission | Access granted |
|---|---|
| `view_reports` | Fleet overview, regional summaries, and resource health |
| `inspect_evidence` | Incidents, blocking chains, deadlocks, Top SQL, execution plans, schema catalogs, and original payloads |
| `export_evidence` | JSON evidence export (requires `inspect_evidence` on the same resource) |

To scope a team to specific databases only, add `resources` to a grant using the 64-character hex `namespace_id` and `database` selectors from the fleet row:

```json
{
  "provider": "corporate",
  "archive": "production",
  "claim": "roles",
  "value": "Culprit.CheckoutTeam",
  "permissions": ["inspect_evidence"],
  "resources": [{
    "label": "Checkout",
    "selector": {
      "namespace_id": "<64-hex-chars>",
      "database": "<64-hex-chars>"
    }
  }]
}
```

## Connect Coding Agents (MCP)

Every `culprit-fleet` instance serves a read-only Streamable HTTP MCP endpoint at `POST /mcp` alongside RFC 9728 Protected Resource Metadata (`GET /.well-known/oauth-protected-resource`).

- Authenticates Microsoft Entra ID / OIDC Bearer tokens against cached JWKS (`<client_id>` or `api://<client_id>`).
- Enforces the exact same per-archive and per-database RBAC grants as the web UI and logs every call to `access_audit`.
- Exposes `list_archives`, `fleet_overview`, `investigate_incident`, `query_database_window`, and `diff_execution_plans`.

```sh
TOKEN="$(az account get-access-token --resource api://<ENTRA-CLIENT-ID> --query accessToken -o tsv)"
claude mcp add --transport http culprit-fleet "https://YOUR-HOST/mcp" \
  --header "Authorization: Bearer ${TOKEN}"
```

## Run from Source

```sh
git submodule update --init --recursive
bun install --frozen-lockfile
bun run build
cargo build --locked
./target/debug/culprit-fleet /absolute/path/to/web.json
```

Listens on `127.0.0.1:8080` by default (override via `CULPRIT_FLEET_BIND`). Set `metadata_db` (for example `/var/lib/culprit-fleet/workspace.sqlite3`) on a persistent volume to retain saved views and the `access_audit` log across restarts.
