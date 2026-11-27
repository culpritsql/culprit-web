# Development and verification

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

Browser tests run the application binary with a disposable loopback OIDC provider, real signed tokens and synthetic archive responses. They exercise authorization on the HTTP routes, incident links across sign-in, window pagination and explicit reads of original payloads. The native storage test uses Docker, the AWS CLI and Python 3. It starts two independent ClickHouse servers and two S3-compatible object stores. One web process serves both archives. A regional DBA opens the European SQL Server history, while a US-scoped DBA and viewer exercise the PostgreSQL incident and its evidence permissions.

```sh
python3 -B tests/native/verify.py
```

| Input | Browser proof |
|---|---|
| Published SQL Server resource observation | After recovery restarts, Fleet opens the database and reports an empty incident window. |
| PostgreSQL blocking corpus | A DBA opens the established blocking owner and reads the affected statement from its original. A fleet viewer receives a denial for the same incident link and a 403 when replaying the DBA's successful original-SQL request. |
| Regional outage | The runner stops both European stores. Europe reports an error while the US fleet, incident and original remain accessible in the same web process. Each ClickHouse archive uses its own read-only login. |
| Missing Azure identity | The same process opens an ADX/Blob configuration for Japan. Its missing workload identity assertion produces an error on the Japan card while the other archives remain independently readable. |

### Verify Azure Data Explorer and Blob alongside ClickHouse

Use a dedicated archive of synthetic incidents. Give the web process an evidence config with read access to ADX and Blob. Select a published native blocking incident with an affected statement and its original SQL. Supply its investigation link from a deployment using the same config and archive name `production`. The fixture follows the link's database, archive revision and time window on loopback.

```sh
python3 -B tests/native/verify.py --azure-archive /path/to/azure-evidence.json \
  --incident-link "$CULPRIT_TEST_INCIDENT_URL"
```

This run reads the supplied archive. It creates the other region's ClickHouse/S3 stores locally, stops them, and repeats the evidence and access checks against Azure. The test identity provider runs on loopback. Live Microsoft Entra sign-in requires the tenant's registered web application.

## Refresh the README screenshots

```sh
bun run build
cargo build --locked
CULPRIT_WEB_SCREENSHOTS=1 bun run test:e2e showcase demo
```

The showcase signs in with a disposable OIDC identity, opens Checkout from Fleet, follows the resource into Workload and expands a captured plan. It captures both system themes. Fleet and incident responses describe an illustrative estate. The workload uses the pinned SQL Server sample report with its recorded queries and plans.
