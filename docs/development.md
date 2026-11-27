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

Browser tests run the application binary with a disposable loopback OIDC provider, real signed tokens and synthetic archive responses. They exercise authorization on the HTTP routes, incident links across sign-in, window pagination and explicit reads of original payloads. The native storage test uses Docker, the AWS CLI and Python 3. It publishes a SQL Server observation through the pinned collector fixture, restarts S3-backed recovery, and opens the database and historical window in Chromium through real ClickHouse and S3-compatible reads. It creates disposable credentials and removes its containers afterward.

```sh
python3 -B tests/native/verify.py
```

The native fixture contains a resource observation. Browser fixtures supply the detailed incident, attributed and affected queries, and original payload. A live Entra tenant and a published incident on both warehouse backends remain pilot checks.

## Refresh the README screenshots

```sh
bun run build
cargo build --locked
CULPRIT_WEB_SCREENSHOTS=1 bun run test:e2e showcase
```

The showcase signs in with a disposable OIDC identity, opens Checkout from Fleet, follows the resource into Workload and expands a captured plan. It captures both system themes. Fleet and incident responses describe an illustrative estate. The workload uses the pinned SQL Server sample report with its recorded queries and plans.
