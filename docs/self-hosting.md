# Self-host Culprit Web

## Run from source

Use stable Rust, Bun and Node.js for the browser tests. Run these commands from the web repo.

```sh
git submodule update --init --recursive
bun install --frozen-lockfile
bun run build
cargo build --locked
./target/debug/culprit-web /absolute/path/to/web.json
```

Run the binary from the directory containing `dist/`. It listens on `127.0.0.1:8080` by default. Set `CULPRIT_WEB_BIND` to change that address. Terminate HTTPS at a reverse proxy and set `public_url` to the external HTTPS origin. Local development also accepts an HTTP loopback origin.

## Connect published archives

1. Copy the web example, choose an archive name and set `evidence_config` to the mounted archive configuration file. Use the same archive name in every grant. [Web configuration](../config/web.example.json)
2. Copy the configuration for the installed warehouse and recovery service. Match the collector's pipeline, shard, database and recovery namespace. Supply credentials with read access to the published warehouse data and recovery objects. [ClickHouse and S3](../config/archive.example.json) · [ADX and Azure Blob](../config/archive.azure.example.json)
3. For the ClickHouse example, supply `CULPRIT_WAREHOUSE_PASSWORD` to the server and make the configured AWS profile available to its OS user. The container includes the AWS CLI. The Azure example uses a managed identity. Workload identity can also be configured using the upstream credential profile. [Archive reader configuration](https://github.com/culpritsql/culprit-sql-studio/blob/main/docs/collector.md)

### Regional archives

Configure one entry for each independently published pipeline and shard. Use a stable, unique `name` for links and access grants. The optional `region` is a display label. Multiple archives may share a region, including archives on different warehouse backends.

```json
{
  "archives": [
    { "name": "orders-us", "region": "United States", "evidence_config": "/run/config/us-clickhouse.json" },
    { "name": "orders-eu", "region": "Europe", "evidence_config": "/run/config/eu-adx.json" },
    { "name": "orders-jp", "region": "Japan", "evidence_config": "/run/config/jp-clickhouse.json" }
  ]
}
```

Each evidence file specifies its own read credentials, warehouse endpoint and recovery bucket or Blob container. Mount the files referenced in your configuration. Map an identity provider role to each archive it may access. A role with a database-specific grant sees its assigned databases.

**Regional fleets** shows one card per authorized fleet archive. Cards on the same page read at one UTC cutoff and report failures individually. A DBA opens one archive to inspect database rows and original evidence. Deep links and saved investigations carry the archive name and revision as well as the database identity.

The web service reads selected data from its configured regions. For installations that require evidence and audit metadata to stay within a region, deploy the service and its metadata volume in that region and configure only the permitted sources.

## Configure company sign-in

1. For Microsoft Entra ID, register a single-tenant **Web** application. Set the redirect URI to `https://YOUR-HOST/auth/callback/corporate`. Set the tenant-specific issuer with the tenant GUID, application client ID and a mounted client secret file in the web configuration.
2. Define the application roles `Culprit.Viewer` and `Culprit.DBA` and assign users or groups to them. The example maps these values from the verified ID token's `roles` claim. MFA follows the tenant's sign-in policy.
3. For another OIDC provider, configure its discovery issuer, client ID, secret file, user-facing label and unique provider ID. Register `/auth/callback/PROVIDER-ID` at that provider using the full public origin. Configure a custom role or group claim in the ID token, list any required additional scopes under `scopes` and map exact claim values to permissions. Multiple providers may coexist. Each grant belongs to one provider and one archive.

| Permission | What a user can open |
|---|---|
| `view_reports` | Fleet summary and resource list |
| `inspect_evidence` | Fleet, incident details, captured query text in those details, published findings and changes, and original evidence throughout this archive |

A signed-in DBA opens a shared investigation directly. With one provider, an expired or missing local session sends a shared-link visitor to company sign-in and returns them to the investigation. With several providers, they choose one. A user without a matching grant receives an access-denied response. Warehouse access always uses the server's separate credentials.

## Run the container

```sh
docker build -t culprit-web:local .
docker run --rm -p 127.0.0.1:8080:8080 \
  -v "$PWD/runtime/config:/run/config:ro" \
  -v culprit-web-state:/var/lib/culprit-web \
  -v "$PWD/runtime/secrets:/run/secrets:ro" \
  culprit-web:local
```

Place `web.json`, its referenced archive config and the referenced OIDC secret at the mounted paths. Make them readable by UID 65532. For ClickHouse and S3, also pass the configured password environment variable and mount or supply the AWS profile and its credential source. `GET /healthz` reports process liveness. An authenticated fleet read exercises the storage path.

## Assign individual databases

Use `archives` to configure several independently credentialed archives in the same process. Existing single-archive files with `archive_name` and `evidence_config` still load. An archive must appear in a matching grant before a user can discover it.

```json
"archives": [
  { "name": "production", "evidence_config": "/run/config/production.json" },
  { "name": "analytics", "evidence_config": "/run/config/analytics.json" }
]
```

Add `resources` to a grant to limit it to named databases. Copy both complete selector values from the published fleet row. A database name can recur across namespaces. The label here is for navigation.

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
      "namespace_id": "<64 hexadecimal characters from the fleet row>",
      "database": "<64 hexadecimal characters from the fleet row>"
    }
  }]
}
```

A resource-only user sees their assigned databases. Every incident, historical window and original is authorized on the server. Archive-wide viewers can open the fleet. Add an inspection grant for the databases whose SQL and plans they should see.

## Session lifetime

Run one web replica. It can serve multiple archives. Sessions expire after 15 minutes or at the ID token expiration, whichever comes first. Restarting the process signs users out.

## Saved investigations, access auditing and exports

Set `metadata_db` to a file on a persistent volume writable by the web process. The example uses `/var/lib/culprit-web/workspace.sqlite3`. SQLite holds private saved links and an append-only application audit of signed-in archive read decisions. The `access_audit` table records the verified issuer and subject, UTC Unix time, operation, configured archive, validated resource identifiers and authorization decision. Restrict access to the volume and include it in your backup and retention policy.

A saved view stores the title, archive revision, database selector, time, tab, explicit observation window and publication cutoff when selected, and optional incident revision. The server filters the saved list using the user's current permissions. Share the URL to let another DBA open it under their own identity.

Grant `export_evidence` to enable the JSON download in the original-record inspector. The same database must also grant `inspect_evidence`. The download contains the selected archive response, including its page bounds and limitations. The session's existing SQL visibility still applies to the normal inspector.

## Kubernetes

Build and push the Docker image to your registry. Create a ConfigMap containing `web.json` and the archive files it references, a Secret containing your OIDC secret and a PVC for the workspace database.

```sh
helm upgrade --install investigations ./charts/culprit-web \
  --set image=REGISTRY/culprit-web:TAG \
  --set config.existingConfigMap=culprit-web-config \
  --set existingSecret=culprit-web-credentials \
  --set persistence.existingClaim=culprit-web-state
```

Alternatively, supply config objects under `config.files` in a Helm values file. Specify `env` entries with Secret key references for warehouse credentials. Supply a service account and pod labels when using cloud workload identity. For managed ingress, set the host and TLS secret to match `public_url`. Restart the deployment after changing an externally managed ConfigMap. Helm rolls out changes to inline config. An installation using the default temporary state volume loses saved links and audit history on pod replacement. [Chart values](../charts/culprit-web/values.yaml)
