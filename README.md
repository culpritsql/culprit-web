# Culprit Web

A self-hosted DBA workspace for investigating the evidence that Culprit has already published. Open Fleet, select a database, inspect its recorded incidents and follow an evidence reference to the original record inventory and retained SQL or plan text. A shared link identifies the archive revision, database, time and incident revision. Qualified findings and changes are available for the same historical window.

## How it runs

One Rust process serves the React application, handles company sign-in and reads the archive. The browser calls the web application's own origin. The Rust archive reader reads ClickHouse or Azure Data Explorer and resolves original evidence through S3 or Azure Blob. The collector and source databases can be offline during an investigation.

The web app pins its Rust archive reader, engine definitions, generated TypeScript models and browser fixtures to the same revision of Culprit in a Git submodule. The reader owns archive interpretation, integrity and resource identity. Web code owns sign-in, authorization and presentation.

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

### Configure the archive

1. Copy the web example, choose an archive name and set `evidence_config` to the mounted archive configuration file. Use the same archive name in every grant. [Web configuration](config/web.example.json)
2. Copy the configuration for the installed warehouse and recovery service. Match the collector's pipeline, shard, database and recovery namespace. Supply credentials with read access to the published warehouse data and recovery objects. [ClickHouse and S3](config/archive.example.json) · [ADX and Azure Blob](config/archive.azure.example.json)
3. For the ClickHouse example, supply `CULPRIT_WAREHOUSE_PASSWORD` to the server and make the configured AWS profile available to its OS user. The container includes the AWS CLI. The Azure example uses a managed identity. Workload identity can also be configured using the upstream credential profile. [Archive reader configuration](vendor/culprit/docs/collector.md)

### Configure company sign-in

1. For Microsoft Entra ID, register a single-tenant **Web** application. Set the redirect URI to `https://YOUR-HOST/auth/callback/corporate`. Set the tenant-specific issuer with the tenant GUID, application client ID and a mounted client secret file in the web configuration.
2. Define the application roles `Culprit.Viewer` and `Culprit.DBA` and assign users or groups to them. The example maps these values from the verified ID token's `roles` claim. MFA follows the tenant's sign-in policy.
3. For another OIDC provider, configure its discovery issuer, client ID, secret file, user-facing label and unique provider ID. Register `/auth/callback/PROVIDER-ID` at that provider using the full public origin. Configure a custom role or group claim in the ID token, list any required additional scopes under `scopes` and map exact claim values to permissions. Multiple providers may coexist. Each grant belongs to one provider and one archive.

| Permission | What a user can open |
|---|---|
| `view_reports` | Fleet summary and resource list |
| `inspect_evidence` | Fleet, incident details, captured query text in those details, published findings and changes, and original evidence throughout this archive |

A signed-in DBA opens a shared investigation directly. With one provider, an expired or missing local session sends a shared-link visitor to company sign-in and returns them to the investigation. With several providers, they choose one. A user without a matching grant receives an access-denied response. Warehouse access always uses the server's separate credentials.

### Run the container

```sh
docker build -t culprit-web:local .
docker run --rm -p 127.0.0.1:8080:8080 \
  -v "$PWD/runtime/config:/run/config:ro" \
  -v "$PWD/runtime/secrets:/run/secrets:ro" \
  culprit-web:local
```

Place `web.json`, its referenced archive config and the referenced OIDC secret at the mounted paths. Make them readable by UID 65532. For ClickHouse and S3, also pass the configured password environment variable and mount or supply the AWS profile and its credential source. `GET /healthz` reports process liveness. An authenticated fleet read exercises the storage path.

## Validate

```sh
cargo fmt --check
cargo test --locked
bun install --frozen-lockfile
bun run build
cargo build --locked
bunx playwright install chromium --only-shell
bun run test:e2e
```

Browser tests run the application binary with a disposable loopback OIDC provider, real signed tokens and synthetic archive responses. They exercise authorization on the HTTP routes, incident links across sign-in, window pagination and explicit reads of original payloads. The native storage test uses Docker, the AWS CLI and Python 3. It publishes a SQL Server observation through the pinned collector fixture, restarts S3-backed recovery, and opens the database and historical window in Chromium through real ClickHouse and S3-compatible reads. It creates disposable credentials and removes its containers afterward.

```sh
python3 -B tests/native/verify.py
```

The native fixture contains a resource observation. Browser fixtures supply the detailed incident, attributed and affected queries, and original payload. A live Entra tenant and a published incident on both warehouse backends remain pilot checks.

## Current scope

Run one replica per configured archive. Grants cover the entire archive. Sessions expire at the earlier of 15 minutes and the verified ID token's expiration. Restarting the web process signs users out. Per-resource permissions, durable access auditing, saved investigations and multiple archives in one workspace are upcoming milestones.
