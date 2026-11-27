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
| PostgreSQL blocking corpus | The collector seals the activity and its focused follow-up, computes diagnostic revisions and publishes the derived findings. Once the publisher exits, a DBA opens the established blocking owner and reads the affected statement from its authenticated original. A viewer is denied the shared link and direct original route. |

The workload and incident inputs are controlled fixtures. Real Entra sign-in and the end-to-end Azure Data Explorer plus Blob journey require a deployment with those services.

## Refresh the README screenshots

```sh
bun run build
cargo build --locked
CULPRIT_WEB_SCREENSHOTS=1 bun run test:e2e showcase demo
```

The showcase signs in with a disposable OIDC identity, opens Checkout from Fleet, follows the resource into Workload and expands a captured plan. It captures both system themes. Fleet and incident responses describe an illustrative estate. The workload uses the pinned SQL Server sample report with its recorded queries and plans.
