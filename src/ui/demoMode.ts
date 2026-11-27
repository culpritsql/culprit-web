import type { Bookmark, SavedView, Session } from "./api";
import type { PaletteDemoScenario, PaletteResource } from "./CommandPalette";
import {
  archives,
  around,
  computeDemoPlanDiff,
  fleet,
  incidentForResource,
  resource,
  sampleArtifacts,
  sampleWindow,
} from "./demoDataset";
import { getLiveTick } from "./livePulse";
import { fleetRequest } from "./fleetRequest";
import { archiveUrl, investigationUrl, regionsUrl } from "./navigation";
import type { Plan } from "../../vendor/culprit/app/src/gen/Plan";
import type { WarehouseArtifactQuery } from "../../vendor/culprit/app/src/gen/WarehouseArtifactQuery";
import type { WarehouseFleetReport } from "../../vendor/culprit/app/src/gen/WarehouseFleetReport";
import type { WarehouseFleetRequest } from "../../vendor/culprit/app/src/gen/WarehouseFleetRequest";
import type { WarehouseWindowQuery } from "../../vendor/culprit/app/src/gen/WarehouseWindowQuery";
import type { WarehouseWindowReport } from "../../vendor/culprit/app/src/gen/WarehouseWindowReport";

const SAVED_KEY = "culprit-web-demo-saved";

function readDemoBookmarks(): Bookmark[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (raw) return JSON.parse(raw) as Bookmark[];
  } catch {
    /* Ignore storage errors. */
  }
  const us = { name: archives[0]!.name, revision: archives[0]!.revision };
  return [
    {
      id: 1,
      title: "Checkout lock storm (US Prod)",
      connection: us,
      resource,
      around,
      view: "incident",
      incident: null,
      bounds: null,
    },
    {
      id: 2,
      title: "Ledger key-lookup deadlock graph",
      connection: us,
      resource: {
        namespace_id: resource.namespace_id,
        database: "2".repeat(64),
      },
      around,
      view: "resources",
      incident: null,
      bounds: null,
    },
  ];
}

function writeDemoBookmarks(items: Bookmark[]) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(items));
  } catch {
    /* Ignore storage errors. */
  }
}

function cloneJson<T>(value: unknown): T {
  return JSON.parse(
    JSON.stringify(value, (_, item) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  ) as T;
}

function evolveFleetReport(
  rep: WarehouseFleetReport,
  tick: number,
): WarehouseFleetReport {
  if (tick <= 0) return rep;
  const copy = structuredClone(rep);
  copy.rows = copy.rows.map((row, idx) => {
    if (!row.telemetry || row.freshness === "stale") return row;
    const phase = tick * 0.85 + idx * 1.3;
    const deltaCpu = Math.round(Math.sin(phase) * 4 + Math.cos(phase * 0.6) * 2);
    const deltaMem = Math.round(Math.cos(phase * 0.5) * 2);
    const nextCpu = Math.max(
      5,
      Math.min(99, (row.telemetry.cpu_pct ?? 30) + deltaCpu),
    );
    const nextMem = Math.max(
      20,
      Math.min(97, (row.telemetry.memory_pct ?? 50) + deltaMem),
    );
    const spark = [...(row.telemetry.load_sparkline ?? [])];
    if (spark.length >= 4) {
      const shifted = spark.slice(1);
      shifted.push(nextCpu);
      row.telemetry = {
        ...row.telemetry,
        cpu_pct: nextCpu,
        memory_pct: nextMem,
        load_sparkline: shifted,
      };
    }
    return row;
  });
  return copy;
}

function evolveWindowReport(
  rep: WarehouseWindowReport,
  tick: number,
): WarehouseWindowReport {
  if (tick <= 0 || !rep.telemetry) return rep;
  const copy = structuredClone(rep);
  const res = copy.telemetry?.resources[0];
  if (res && res.samples.length > 2) {
    res.samples = res.samples.map((s, idx) => {
      const wave = Math.round(Math.sin(tick * 0.7 + idx * 0.45) * 3);
      return {
        ...s,
        cpu_pct:
          s.cpu_pct != null ? Math.max(5, Math.min(99, s.cpu_pct + wave)) : null,
        data_io_pct:
          s.data_io_pct != null
            ? Math.max(2, Math.min(95, s.data_io_pct + Math.round(wave * 0.7)))
            : null,
      };
    });
  }
  return copy;
}

function demoMcpCall(body: {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}) {
  const id = body.id ?? 1;
  if (body.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "culprit-web-mcp", version: "0.1.0" },
      },
    };
  }
  if (body.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "list_archives",
            description:
              "List authorized regional scale units / archives and granted RBAC permissions.",
          },
          {
            name: "fleet_overview",
            description:
              "Query database health, active incidents, high findings, and CPU/Memory telemetry in an archive.",
          },
          {
            name: "investigate_incident",
            description:
              "Inspect root cause, blocking owner, victim SQL, and developer fix for a database incident.",
          },
          {
            name: "query_database_window",
            description:
              "Read Top SQL workload, CPU/Memory/Waits, or published Schema & Operational findings for a UTC window.",
          },
          {
            name: "diff_execution_plans",
            description:
              "Compare two captured execution plans and explain operator & cost regressions.",
          },
        ],
      },
    };
  }
  if (body.method === "tools/call") {
    const tool = body.params?.name;
    if (tool === "list_archives") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                archives.map((a) => ({
                  archive: a.name,
                  region: a.region,
                  databases: a.rows.length,
                  permissions: ["view_reports", "inspect_evidence"],
                })),
                null,
                2,
              ),
            },
          ],
        },
      };
    }
    const us = archives[0]!;
    const rep = fleet(us, fleetRequest(around, 8, true));
    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                archive: us.name,
                summary: rep.summary,
                attention_databases: rep.rows.map((r) => ({
                  database: r.database_name,
                  engine: r.engine,
                  active_incidents: r.active_incidents,
                  high_findings: r.high_findings,
                  cpu_pct: r.telemetry?.cpu_pct,
                  memory_pct: r.telemetry?.memory_pct,
                  dominant_wait: r.telemetry?.dominant_wait,
                })),
              },
              null,
              2,
            ),
          },
        ],
      },
    };
  }
  return { jsonrpc: "2.0", id, result: {} };
}

export async function demoRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const tick = getLiveTick();

  if (method === "POST" && path === "/mcp") {
    return cloneJson<T>(demoMcpCall((body ?? {}) as Record<string, unknown>));
  }

  if (method === "GET" && path === "/api/session") {
    const access = {
      view_fleet: true,
      inspect_evidence: true,
      export_evidence: true,
      resources: [],
    };
    const session: Session = {
      access: {
        archives: Object.fromEntries(archives.map((a) => [a.name, access])),
      },
      regions: Object.fromEntries(archives.map((a) => [a.name, a.region])),
      providers: [],
      saved_views_enabled: true,
      read_defaults: { window_page_rows: 8, artifact_chunk_chars: 4096 },
    };
    return cloneJson<T>(session);
  }

  if (method === "GET" && path === "/api/archive/connections") {
    return cloneJson<T>(
      archives.map(({ name, revision }) => ({
        reference: { name, revision },
      })),
    );
  }

  if (method === "GET" && path === "/api/workspace/saved") {
    return cloneJson<T>(readDemoBookmarks());
  }

  if (method === "POST" && path === "/api/workspace/saved") {
    const view = body as SavedView;
    const current = readDemoBookmarks();
    const nextId = current.reduce((m, item) => Math.max(m, item.id), 0) + 1;
    writeDemoBookmarks([{ ...view, id: nextId }, ...current]);
    return undefined as T;
  }

  if (method === "DELETE" && path.startsWith("/api/workspace/saved/")) {
    const id = Number(path.split("/").pop());
    writeDemoBookmarks(readDemoBookmarks().filter((item) => item.id !== id));
    return undefined as T;
  }

  if (method === "POST" && path === "/api/plans/diff") {
    const req = body as { a: Plan; b: Plan; nameA: string; nameB: string };
    return cloneJson<T>(
      computeDemoPlanDiff(req.a, req.b, req.nameA, req.nameB),
    );
  }

  const envelope = body as {
    connection?: { name: string; revision: string };
    resource?: { namespace_id: string; database: string };
    request?: unknown;
  };
  const archive = archives.find(
    (a) =>
      a.name === envelope?.connection?.name &&
      a.revision === envelope?.connection?.revision,
  );
  if (!archive) throw new Error("Unknown sample archive.");

  switch (path) {
    case "/api/archive/fleet":
      return cloneJson<T>(
        evolveFleetReport(
          fleet(archive, envelope.request as WarehouseFleetRequest),
          tick,
        ),
      );
    case "/api/archive/incident":
      return cloneJson<T>(
        incidentForResource(archive, envelope.resource?.database ?? ""),
      );
    case "/api/archive/window":
      return cloneJson<T>(
        evolveWindowReport(
          sampleWindow(archive, envelope.request as WarehouseWindowQuery),
          tick,
        ),
      );
    case "/api/archive/artifacts":
    case "/api/archive/export": {
      const res = sampleArtifacts(
        archive,
        envelope.request as WarehouseArtifactQuery,
      );
      if (!res) throw new Error("No original record was returned.");
      return cloneJson<T>(res);
    }
    default:
      throw new Error(`Unsupported demo endpoint: ${path}`);
  }
}

export function getDemoScenarios(): PaletteDemoScenario[] {
  const us = { name: archives[0]!.name, revision: archives[0]!.revision };
  return [
    {
      label: "Global Fleet Command (24h / 7d / 30d)",
      detail: "Executive incident trends, root-cause rollup & cross-region triage",
      href: regionsUrl(),
    },
    {
      label: "US Production Fleet Command Center",
      detail: "8 databases · CPU/Memory meters, pool grouping & silent targets",
      href: archiveUrl(us.name),
    },
    {
      label: "Checkout Lock Storm & Blocking Tree",
      detail: "SQL Server · Synchronized 3-lane timeline & causal attribution",
      href: investigationUrl(us, resource, around, "incident"),
    },
    {
      label: "Top SQL & Slide-Over Plan Inspector",
      detail: "Rank by CPU / Reads / Time and inspect 151× plan diff in wide drawer",
      href: investigationUrl(us, resource, around, "workload"),
    },
    {
      label: "Schema & Index Remediation Workbench",
      detail: "Ranked index & bloat findings with syntax-highlighted online DDL",
      href: investigationUrl(us, resource, around, "schema"),
    },
    {
      label: "Ledger Deadlock Cycle Graph",
      detail: "Interactive lock-cycle SVG diagram & victim resolution",
      href: investigationUrl(
        us,
        { namespace_id: resource.namespace_id, database: "2".repeat(64) },
        around,
        "resources",
      ),
    },
    {
      label: "Orders PostgreSQL Replica Lag",
      detail: "Aurora PostgreSQL · Streaming WAL replay lag & HA health",
      href: investigationUrl(
        us,
        { namespace_id: resource.namespace_id, database: "1".repeat(64) },
        around,
        "resources",
      ),
    },
  ];
}

export function getDemoPaletteResources(): PaletteResource[] {
  return archives.flatMap((arch) =>
    arch.rows.map((row) => ({
      name: row.database_name,
      engine: row.engine,
      environment: row.environment,
      archive: { name: arch.name, revision: arch.revision },
      selector: row.selector,
      around: row.latest_observed_until ?? row.latest_collected_until,
      freshness: row.freshness,
      sharedGroup: row.shared_group,
      activeIncidents: row.active_incidents,
      cpuPct: row.telemetry?.cpu_pct ?? null,
      memoryPct: row.telemetry?.memory_pct ?? null,
      dominantWait: row.telemetry?.dominant_wait ?? null,
      latestCollectedUntil: row.latest_collected_until,
    })),
  );
}
