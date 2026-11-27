<div align="center">

<img src="docs/images/culprit.svg" width="60" height="60" alt="" />

# Culprit Web

**Database fleet command center and archive time-machine — investigate incidents, resource spikes, plan regressions and deadlocks even after the database has recovered.**

[![Checks](https://img.shields.io/github/actions/workflow/status/culpritsql/culprit-web/check.yml?branch=main&style=flat-square&label=checks&labelColor=181715)](https://github.com/culpritsql/culprit-web/actions/workflows/check.yml)
[![OCI & Helm](https://img.shields.io/github/actions/workflow/status/culpritsql/culprit-web/publish.yml?branch=main&style=flat-square&label=ghcr%20%26%20helm&labelColor=181715)](https://github.com/culpritsql/culprit-web/actions/workflows/publish.yml)
[![Demo](https://img.shields.io/github/actions/workflow/status/culpritsql/culprit-web/pages.yml?branch=main&style=flat-square&label=live%20demo&labelColor=181715)](https://culpritsql.github.io/culprit-web/)
[![Archive reader](https://img.shields.io/badge/archive-Culprit-ffcf33?style=flat-square&labelColor=181715)](https://github.com/culpritsql/culprit-sql-studio)
[![Self hosted](https://img.shields.io/badge/self--hosted-OIDC%20%2B%20MCP-89ad96?style=flat-square&labelColor=181715)](docs/self-hosting.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-6b93f0?style=flat-square&labelColor=181715)](LICENSE)

[Fleet](#fleet) · [Investigations](#investigations) · [Historical workload](#historical-workload) · [Live demo](#try-the-demo) · [Quickstart](#quickstart)

</div>

## Fleet

See which databases need attention across regions, monitor CPU and memory saturation, group shared compute pools and HA clusters, spot silent collector targets, and jump anywhere instantly with `⌘K`. Switch between five curated themes (**Culprit Obsidian**, **Midnight Nebula**, **Operator Terminal**, **Daylight Paper**, **Nordic Frost**) or follow your OS theme automatically.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/fleet-dark.png">
  <img src="docs/images/fleet-light.png" alt="Fleet overview of eight sample databases showing active incidents, CPU and memory utilization, load sparklines and collection coverage" width="100%">
</picture>

## Try the demo

Explore the [hosted interactive demo](https://culpritsql.github.io/culprit-web/) directly in your browser (zero backend required), or run the sample estate locally with Bun:

```sh
git clone --recurse-submodules https://github.com/culpritsql/culprit-web.git
cd culprit-web
bun install --frozen-lockfile
bun run demo
```

Open [Regional fleets](http://127.0.0.1:4390/?view=regions). Choose the United States, open **Checkout**, inspect **Resources & waits** (CPU/memory curves, wait breakdown, session blocking tree and deadlock graph), or open **Workload** and click **Compare plans** on the top statement.

To build the standalone static showcase bundle:

```sh
bun run build:demo
```

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/regions-dark.png">
  <img src="docs/images/regions-light.png" alt="Three regional archives, each showing its own resource, incident and collection coverage counts" width="100%">
</picture>

## Quickstart

Connect a published **ClickHouse + S3** or **Azure Data Explorer + Azure Blob** archive and your company's OIDC provider. One service serves the React app, handles sign-in and reads the configured archives. Give each regional archive its own endpoints, object storage and access grants. The collector and source database can be offline.

```sh
git clone --recurse-submodules https://github.com/culpritsql/culprit-web.git
cd culprit-web
bun install --frozen-lockfile
bun run build
cargo run --locked -- /absolute/path/to/web.json
```

For credentials, role mappings, HTTPS, prebuilt multi-arch `ghcr.io/culpritsql/culprit-web` containers, the `oci://ghcr.io/culpritsql/charts/culprit-web` Helm chart, and connecting coding agents via `POST /mcp` (Microsoft Entra ID / OIDC), follow the [self-hosting guide](docs/self-hosting.md). Start with the [example web configuration](config/web.example.json).

## Investigations

Save a view for your next shift or share a link to the database, time window and incident revision. Correlate load spikes, CPU/memory pressure and incidents on the synchronized multi-lane timeline, follow a waiting statement to its recorded head blocker, inspect captured deadlock cycles (`@culpritsql/plan-viewer`), and open authenticated original evidence.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/investigation-dark.png">
  <img src="docs/images/investigation-light.png" alt="Checkout investigation showing a 42-second wait, the blocking session, the affected SQL and links to original records" width="100%">
</picture>

## Historical workload

Rank statements by total time, CPU time, logical reads, mean duration or calls, with resource-share percentages per query. Drag across a spike or select buckets with the keyboard to investigate that exact interval. Click any statement to open the wide slide-over inspector drawer with syntax-highlighted SQL, recorded waits, runtime by plan, interactive execution plan diagrams and side-by-side structural plan comparisons (`PlanViewer` and `PlanDiffViewer`).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/workload-dark.png">
  <img src="docs/images/workload-light.png" alt="Top SQL with native Query Store intervals, statement time, calls, CPU and logical reads" width="100%">
</picture>

The screenshots use a sample estate and Culprit's SQL Server workload fixture. The native integration test separately verifies a published PostgreSQL blocker and its original SQL on ClickHouse and S3-compatible storage. The browser suite reproduces the same journey across themes. [Development and verification](docs/development.md)
