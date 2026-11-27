<div align="center">

<img src="docs/images/culprit.svg" width="60" height="60" alt="" />

# Culprit Web

**Investigate a database incident after the database has recovered.**

[![Checks](https://img.shields.io/github/actions/workflow/status/culpritsql/culprit-web/check.yml?branch=main&style=flat-square&label=checks&labelColor=181715)](https://github.com/culpritsql/culprit-web/actions/workflows/check.yml)
[![Archive reader](https://img.shields.io/badge/archive-Culprit-ffcf33?style=flat-square&labelColor=181715)](https://github.com/culpritsql/culprit-sql-studio)
[![Self hosted](https://img.shields.io/badge/self--hosted-OIDC-89ad96?style=flat-square&labelColor=181715)](docs/self-hosting.md)

[Fleet](#fleet) · [Investigations](#investigations) · [Historical workload](#historical-workload) · [Quickstart](#quickstart)

</div>

## Fleet

See which databases need attention, where incidents cluster and which collectors have fallen behind. Open a database to inspect the evidence behind its counts.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/fleet-dark.png">
  <img src="docs/images/fleet-light.png" alt="Fleet overview of eight sample databases, showing six active incidents and two databases with stale or partial collection" width="100%">
</picture>

## Quickstart

Connect a published **ClickHouse + S3** or **Azure Data Explorer + Azure Blob** archive and your company's OIDC provider. One service serves the React app, handles sign-in and reads the archive. The collector and source database can be offline.

```sh
git clone --recurse-submodules https://github.com/culpritsql/culprit-web.git
cd culprit-web
bun install --frozen-lockfile
bun run build
cargo run --locked -- /absolute/path/to/web.json
```

For credentials, role mappings, HTTPS and container deployment, follow the [self-hosting guide](docs/self-hosting.md). Start with the [example web configuration](config/web.example.json).

## Investigations

A shared link opens the database, time window and incident revision. Follow a waiting statement to its recorded blocker, inspect the original evidence, then use the suggested verification step to check the fix.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/investigation-dark.png">
  <img src="docs/images/investigation-light.png" alt="Checkout investigation showing a 42-second wait, the blocking session, the affected SQL and links to original records" width="100%">
</picture>

## Historical workload

Rank statements by total time, calls or mean duration. Inspect native time buckets, expand captured plans and review changes across comparable periods. Each source population keeps its own totals.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/workload-dark.png">
  <img src="docs/images/workload-light.png" alt="Top SQL with native Query Store intervals, statement time, calls, CPU and logical reads" width="100%">
</picture>

The screenshots use a sample estate and Culprit's SQL Server workload fixture. The browser suite reproduces the same journey in both themes. [Development and verification](docs/development.md)
