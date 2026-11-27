import sampleReportJson from "../../vendor/culprit/fixtures/mssql-demo.report.json" with { type: "json" };
import { partial, fromRust } from "../../vendor/culprit/app/src/test/fixtures";
import { warehouseArtifactCase } from "../../vendor/culprit/app/src/test/warehouse-artifacts";
import { warehouseIncidentCase } from "../../vendor/culprit/app/src/test/warehouse-incidents";
import { warehouseWindowCase } from "../../vendor/culprit/app/src/test/warehouse-windows";
import type { BlockingReport } from "../../vendor/culprit/app/src/gen/BlockingReport";
import type { Changes } from "../../vendor/culprit/app/src/gen/Changes";
import type { CollectedQueryWindowAnalysis } from "../../vendor/culprit/app/src/gen/CollectedQueryWindowAnalysis";
import type { Deadlock } from "../../vendor/culprit/app/src/gen/Deadlock";
import type { Engine } from "../../vendor/culprit/app/src/gen/Engine";
import type { Finding } from "../../vendor/culprit/app/src/gen/Finding";
import type { JobExecutionEvent } from "../../vendor/culprit/app/src/gen/JobExecutionEvent";
import type { NodeResources } from "../../vendor/culprit/app/src/gen/NodeResources";
import type { Plan } from "../../vendor/culprit/app/src/gen/Plan";
import type { PlanChange } from "../../vendor/culprit/app/src/gen/PlanChange";
import type { PlanDiff } from "../../vendor/culprit/app/src/gen/PlanDiff";
import type { PlanNode } from "../../vendor/culprit/app/src/gen/PlanNode";
import type { PlanVariant } from "../../vendor/culprit/app/src/gen/PlanVariant";
import type { QueryStat } from "../../vendor/culprit/app/src/gen/QueryStat";
import type { ReplicationReport } from "../../vendor/culprit/app/src/gen/ReplicationReport";
import type { Report } from "../../vendor/culprit/app/src/gen/Report";
import type { WarehouseArtifactQuery } from "../../vendor/culprit/app/src/gen/WarehouseArtifactQuery";
import type { WarehouseFleetReport } from "../../vendor/culprit/app/src/gen/WarehouseFleetReport";
import type { WarehouseFleetRequest } from "../../vendor/culprit/app/src/gen/WarehouseFleetRequest";
import type { WarehouseFleetRow } from "../../vendor/culprit/app/src/gen/WarehouseFleetRow";
import type { WarehouseIncidentView } from "../../vendor/culprit/app/src/gen/WarehouseIncidentView";
import type { WarehouseWindowQuery } from "../../vendor/culprit/app/src/gen/WarehouseWindowQuery";
import type { WarehouseWindowReport } from "../../vendor/culprit/app/src/gen/WarehouseWindowReport";
import type { WindowOriginal } from "../../vendor/culprit/app/src/gen/WindowOriginal";
import type { WindowPublishedAnalysis } from "../../vendor/culprit/app/src/gen/WindowPublishedAnalysis";
import type { WindowPublishedChange } from "../../vendor/culprit/app/src/gen/WindowPublishedChange";
import type { WindowPublishedFinding } from "../../vendor/culprit/app/src/gen/WindowPublishedFinding";
import type { WindowTelemetry } from "../../vendor/culprit/app/src/gen/WindowTelemetry";
import type { Workload } from "../../vendor/culprit/app/src/gen/Workload";

const sampleReport = fromRust<Report>(sampleReportJson);
const sample = sampleReport.snapshot;

export const indexFinding: Finding =
  sampleReport.findings.find((f) => f.category === "indexes") ??
  sampleReport.findings[0]!;

function buildBaselineSeekPlan(regressed: Plan): Plan {
  const base = structuredClone(regressed);
  base.total_cost = Number(
    Math.max(0.032, regressed.total_cost / 151.4).toFixed(4),
  );
  base.warnings = [];
  const rewriteScan = (node: PlanNode): boolean => {
    const lower = node.op.toLowerCase();
    if (lower.includes("scan")) {
      node.op = "Index Seek";
      node.index = node.index || "ix_customers_email_covering";
      node.self_cost = Number(Math.max(0.012, node.self_cost / 180).toFixed(4));
      node.subtree_cost = Number(
        Math.max(0.012, node.subtree_cost / 180).toFixed(4),
      );
      if (node.act_rows != null) {
        node.act_rows = Math.min(node.act_rows, 48);
      }
      if (node.act_time_ms != null) {
        node.act_time_ms = Number(
          Math.max(0.4, node.act_time_ms / 95).toFixed(2),
        );
      }
      node.warnings = [];
      return true;
    }
    return node.children.some(rewriteScan);
  };
  rewriteScan(base.root);
  return base;
}

function prepareDemoWorkload(raw: Workload): Workload {
  const copy = structuredClone(raw);
  const targetQuery =
    copy.queries.find((q) => q.plan != null && q.executions >= 100) ??
    copy.queries.find((q) => q.plan != null) ??
    copy.queries[0];
  if (
    targetQuery &&
    targetQuery.plan &&
    !targetQuery.plan_history?.captured_plan
  ) {
    const baseline = buildBaselineSeekPlan(targetQuery.plan);
    targetQuery.plan_history = {
      kind: "workload",
      source: { text: "Query Store plan history." },
      note: {
        text: "Plan switched from ix_customers_email_covering seek to a scan after parameter sniffing.",
      },
      captured_plan_id: "plan-4102",
      captured_plan: baseline,
    };
    if (targetQuery.plans.length < 2) {
      targetQuery.plans = [
        partial<PlanVariant>({
          id: "plan-4102",
          executions: 18420,
          mean_time_ms: 0.4,
          cpu_time_ms: 0.3,
          logical_reads: 4,
          first_seen: copy.window_start,
          last_seen: copy.window_end,
        }),
        partial<PlanVariant>({
          id: "plan-4189",
          executions: targetQuery.executions,
          mean_time_ms: targetQuery.mean_time_ms,
          cpu_time_ms: targetQuery.cpu_time_ms,
          logical_reads: targetQuery.logical_reads,
          first_seen: copy.window_start,
          last_seen: copy.window_end,
        }),
      ];
    }
  }
  return copy;
}

export const workload: Workload = prepareDemoWorkload(sample.workload!);
export const sampleDeadlocks: Deadlock[] = sample.deadlocks?.deadlocks ?? [];
export const around = sample.taken_at;

const before = (seconds: number) =>
  new Date(Date.parse(around) - seconds * 1000).toISOString();

export const resource = {
  namespace_id: "a".repeat(64),
  database: "b".repeat(64),
};

function buildEngineWorkload(engine: Engine, base: Workload): Workload {
  if (engine === "mssql") return base;
  const copy = structuredClone(base);
  if (engine === "postgres") {
    copy.source = "pg_stat_statements";
    const pgQueries: Array<[string, string, number, number, number, number]> = [
      [
        "pg-q1",
        "UPDATE public.orders SET fulfillment_state = $1, updated_at = now() WHERE batch_id = $2",
        84200,
        46.8,
        1800,
        14200,
      ],
      [
        "pg-q2",
        "SELECT o.id, o.customer_id, o.total_cents, c.tier FROM public.orders o JOIN public.customers c ON c.id = o.customer_id WHERE o.created_at >= $1 ORDER BY o.created_at DESC LIMIT 50",
        51400,
        12.4,
        4145,
        38900,
      ],
      [
        "pg-q3",
        "SELECT product_id, SUM(quantity) AS units FROM public.order_items WHERE warehouse_id = $1 AND allocated_at IS NULL GROUP BY product_id",
        29180,
        30.4,
        960,
        26400,
      ],
      [
        "pg-q4",
        "INSERT INTO public.outbox_events (aggregate_id, topic, payload) VALUES ($1, $2, $3::jsonb) RETURNING id",
        11840,
        0.4,
        29600,
        8910,
      ],
      [
        "pg-q5",
        "SELECT id, sku, available_qty FROM public.inventory_ledger WHERE sku = ANY($1::text[]) FOR UPDATE",
        9420,
        3.9,
        2415,
        3120,
      ],
    ];
    copy.queries = pgQueries.map(([id, text, total, mean, execs, cpu], idx) =>
      partial<QueryStat>({
        ...(copy.queries[idx] ?? copy.queries[0]!),
        id,
        text,
        object_name: null,
        total_time_ms: total,
        mean_time_ms: mean,
        executions: execs,
        cpu_time_ms: cpu,
        logical_reads: execs * 42,
        plan: idx === 1 ? copy.queries.find((q) => q.plan)?.plan ?? null : null,
        plan_history: undefined,
        plans: [],
        waits: [
          {
            category: idx === 0 ? "IO" : idx === 4 ? "Lock" : "CPU",
            wait_type:
              idx === 0
                ? "IO: WALSync"
                : idx === 4
                  ? "Lock: transactionid"
                  : "CPU",
            wait_ms: Math.round(total * 0.62),
            tasks: execs,
          },
        ],
      }),
    );
    copy.query_count = copy.queries.length;
    copy.total_executions = copy.queries.reduce((s, q) => s + q.executions, 0);
    return copy;
  }

  // MySQL performance_schema
  copy.source = "performance_schema";
  const myQueries: Array<[string, string, number, number, number, number]> = [
    [
      "my-q1",
      "SELECT tenant_id, DATE(occurred_at) AS d, COUNT(*) AS events, SUM(revenue_micros) FROM analytics.events WHERE occurred_at >= ? GROUP BY tenant_id, DATE(occurred_at)",
      142600,
      297.1,
      480,
      128400,
    ],
    [
      "my-q2",
      "SELECT s.id, s.carrier, s.tracking_code FROM fulfillment.shipments s WHERE s.external_ref = ? ORDER BY s.updated_at DESC LIMIT 20",
      48900,
      19.5,
      2508,
      41200,
    ],
    [
      "my-q3",
      "UPDATE fulfillment.pick_lists SET state = ?, assigned_worker = ? WHERE warehouse_zone = ? AND state = 'QUEUED' LIMIT 100",
      19300,
      16.1,
      1200,
      6800,
    ],
    [
      "my-q4",
      "INSERT INTO analytics.session_rollups (account_id, window_start, page_views, conversions) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE page_views = page_views + VALUES(page_views)",
      12750,
      0.8,
      15900,
      9400,
    ],
  ];
  copy.queries = myQueries.map(([id, text, total, mean, execs, cpu], idx) =>
    partial<QueryStat>({
      ...(copy.queries[idx] ?? copy.queries[0]!),
      id,
      text,
      object_name: null,
      total_time_ms: total,
      mean_time_ms: mean,
      executions: execs,
      cpu_time_ms: cpu,
      logical_reads: execs * 115,
      plan: null,
      plan_history: undefined,
      plans: [],
      waits: [
        {
          category: idx === 0 ? "CPU" : "IO",
          wait_type:
            idx === 0
              ? "CPU"
              : "wait/io/file/innodb/innodb_data_file",
          wait_ms: Math.round(total * 0.7),
          tasks: execs,
        },
      ],
    }),
  );
  copy.query_count = copy.queries.length;
  copy.total_executions = copy.queries.reduce((s, q) => s + q.executions, 0);
  return copy;
}

interface SeedEntry {
  name: string;
  engine: WarehouseFleetRow["engine"];
  environment: string;
  active: number;
  high: number;
  regressions: number;
  freshness: WarehouseFleetRow["freshness"];
  sharedGroup: WarehouseFleetRow["shared_group"];
  telemetry: NonNullable<WarehouseFleetRow["telemetry"]>;
}

const seeds: SeedEntry[] = [
  {
    name: "Checkout",
    engine: "mssql",
    environment: "Production",
    active: 3,
    high: 2,
    regressions: 1,
    freshness: "observed",
    sharedGroup: {
      member_id: "pool-commerce-us",
      member_kind: "pool",
      label: "pool-commerce",
    },
    telemetry: {
      cpu_pct: 76,
      memory_pct: 74,
      data_io_pct: 46,
      workers_pct: 58,
      load_sparkline: [22, 26, 31, 48, 86, 94, 79, 76],
      cpu_sparkline: [24, 28, 35, 54, 81, 88, 77, 76],
      dominant_wait: "Lock",
    },
  },
  {
    name: "Orders",
    engine: "postgres",
    environment: "Production",
    active: 2,
    high: 1,
    regressions: 1,
    freshness: "observed",
    sharedGroup: {
      member_id: "aurora-orders-us",
      member_kind: "instance",
      label: "aurora-orders",
    },
    telemetry: {
      cpu_pct: 58,
      memory_pct: 69,
      data_io_pct: 41,
      workers_pct: 44,
      load_sparkline: [28, 34, 42, 65, 72, 63, 59, 58],
      cpu_sparkline: [26, 31, 39, 58, 66, 60, 58, 58],
      dominant_wait: "IO",
    },
  },
  {
    name: "Ledger",
    engine: "mssql",
    environment: "Production",
    active: 1,
    high: 1,
    regressions: 0,
    freshness: "partial",
    sharedGroup: {
      member_id: "pool-commerce-us",
      member_kind: "pool",
      label: "pool-commerce",
    },
    telemetry: {
      cpu_pct: 49,
      memory_pct: 64,
      data_io_pct: 31,
      workers_pct: 36,
      load_sparkline: [19, 24, 29, 67, 61, 52, 48, 49],
      cpu_sparkline: [18, 22, 27, 53, 55, 48, 47, 49],
      dominant_wait: "Lock",
    },
  },
  {
    name: "Fulfillment",
    engine: "mysql",
    environment: "Production",
    active: 0,
    high: 1,
    regressions: 0,
    freshness: "stale",
    sharedGroup: null,
    telemetry: {
      cpu_pct: 38,
      memory_pct: 71,
      data_io_pct: 44,
      workers_pct: 24,
      load_sparkline: [35, 39, 42, 40, 39, 38],
      cpu_sparkline: [33, 37, 40, 39, 38, 38],
      dominant_wait: "IO",
    },
  },
  {
    name: "Catalog",
    engine: "postgres",
    environment: "Production",
    active: 0,
    high: 0,
    regressions: 0,
    freshness: "observed",
    sharedGroup: {
      member_id: "aurora-orders-us",
      member_kind: "instance",
      label: "aurora-orders",
    },
    telemetry: {
      cpu_pct: 29,
      memory_pct: 58,
      data_io_pct: 18,
      workers_pct: 19,
      load_sparkline: [24, 27, 26, 31, 29, 28, 30, 29],
      cpu_sparkline: [24, 27, 26, 31, 29, 28, 30, 29],
      dominant_wait: "CPU",
    },
  },
  {
    name: "Customer insights",
    engine: "mysql",
    environment: "Analytics",
    active: 0,
    high: 1,
    regressions: 1,
    freshness: "observed",
    sharedGroup: null,
    telemetry: {
      cpu_pct: 92,
      memory_pct: 88,
      data_io_pct: 79,
      workers_pct: 76,
      load_sparkline: [45, 58, 72, 84, 91, 95, 90, 92],
      cpu_sparkline: [42, 55, 69, 82, 89, 94, 91, 92],
      dominant_wait: "CPU",
    },
  },
  {
    name: "Inventory",
    engine: "postgres",
    environment: "Staging",
    active: 0,
    high: 0,
    regressions: 0,
    freshness: "observed",
    sharedGroup: null,
    telemetry: {
      cpu_pct: 16,
      memory_pct: 44,
      data_io_pct: 9,
      workers_pct: 12,
      load_sparkline: [12, 14, 15, 19, 17, 16],
      cpu_sparkline: [12, 14, 15, 19, 17, 16],
      dominant_wait: null,
    },
  },
  {
    name: "Billing",
    engine: "mssql",
    environment: "Staging",
    active: 0,
    high: 0,
    regressions: 0,
    freshness: "observed",
    sharedGroup: null,
    telemetry: {
      cpu_pct: 21,
      memory_pct: 51,
      data_io_pct: 14,
      workers_pct: 15,
      load_sparkline: [18, 22, 19, 24, 20, 21],
      cpu_sparkline: [18, 22, 19, 24, 20, 21],
      dominant_wait: null,
    },
  },
];

export const rows: WarehouseFleetRow[] = seeds.map((seed, i) => {
  const at = before(seed.freshness === "stale" ? 7200 : i * 14);
  return {
    resource_id: seed.name,
    selector: i ? { ...resource, database: i.toString(16).repeat(64) } : resource,
    database_name: seed.name,
    engine: seed.engine,
    environment: seed.environment,
    active_incidents: seed.active,
    high_findings: seed.high,
    freshness: seed.freshness,
    connection_alias: seed.name.toLowerCase().replace(/\s+/g, "-"),
    shared_group: seed.sharedGroup,
    latest_collected_from: at,
    latest_collected_until: at,
    latest_observed_from: at,
    latest_observed_until: at,
    uncertain_incidents: 0,
    actionable_findings: seed.high + 1,
    recent_regressions: seed.regressions,
    recent_changes: 2,
    input_read_complete: seed.freshness !== "partial",
    limitations: [],
    telemetry: seed.telemetry,
  };
});

function buildIncidentCase(opts: {
  database: string;
  dbName: string;
  env: string;
  title: string;
  lifecycle: "active" | "resolved";
  victimSummary: string;
  mechanism: string;
  sql: string;
  ownerExplanation: string;
  action: string;
  verify: string;
  historySteps: Array<{
    offsetSec: number;
    lifecycle: "active" | "resolved";
    stepNote: string;
  }>;
}): WarehouseIncidentView {
  const base = warehouseIncidentCase(opts.victimSummary, opts.database);
  const { report } = base;
  report.from = workload.window_start!;
  report.until = around;
  report.recorded_before = around;
  report.discovery_complete = true;
  report.history.limitations = [];
  const episode = report.incidents[0]!;
  episode.entry.title = opts.title;
  Object.assign(episode.entry, {
    first_seen_at: before(180),
    last_seen_at: before(opts.lifecycle === "active" ? 12 : 84),
    recorded_at: before(opts.lifecycle === "active" ? 8 : 70),
    lifecycle: opts.lifecycle,
  });

  report.history.entries = opts.historySteps.map((step, idx) => ({
    ...structuredClone(episode.entry),
    revision: String(idx + 1),
    revision_id: `${opts.dbName.toLowerCase()}-rev-${idx + 1}`,
    recorded_at: before(step.offsetSec),
    lifecycle: step.lifecycle,
    next_step: step.stepNote,
  }));

  episode.display.database_name = opts.dbName;
  episode.display.environment = opts.env;
  episode.victim_summary = opts.victimSummary;
  episode.mechanism = opts.mechanism;
  const waiter = episode.affected_queries[0]!;
  if (waiter.sql.state === "available") waiter.sql.text = opts.sql;
  episode.candidate_queries = [];
  episode.culprit_queries[0]!.causal_role!.explanation.text =
    opts.ownerExplanation;
  episode.developer_action = opts.action;
  episode.verification = opts.verify;
  base.analysis_limitations = [];
  return base;
}

export const view: WarehouseIncidentView = buildIncidentCase({
  database: resource.database,
  dbName: "Checkout",
  env: "Production",
  title: "Checkout requests waited on an open transaction",
  lifecycle: "resolved",
  victimSummary:
    "Checkout writes waited for 42 seconds while a session held an exclusive lock on shop.orders.",
  mechanism:
    "The wait chain linked 3 blocked checkout writers directly to Session 84 (payment-worker). Session 84 acquired LCK_M_X on pk_orders and went idle in transaction while awaiting an external HTTP webhook.",
  sql: "UPDATE checkout.orders SET status = @status WHERE id = @order_id",
  ownerExplanation:
    "Session 84 owned the blocking X key lock for 42.8 s. Its earlier statement executed before the captured activity sample.",
  action:
    "Move the external payment webhook call outside BEGIN TRAN / COMMIT in payment-worker and enable READ_COMMITTED_SNAPSHOT so status readers never block behind writers.",
  verify:
    "Re-run checkout load and confirm LCK_M_U / LCK_M_S waits drop to zero in Resources & waits.",
  historySteps: [
    {
      offsetSec: 175,
      lifecycle: "active",
      stepNote:
        "Detected lock wait chain: 2 checkout-api sessions queued behind idle-in-transaction Session 84 (wait 14.2 s).",
    },
    {
      offsetSec: 120,
      lifecycle: "active",
      stepNote:
        "Escalated: 3 blocked writers and status pollers waiting up to 42.1 s on checkout.orders (pk_orders).",
    },
    {
      offsetSec: 70,
      lifecycle: "resolved",
      stepNote:
        "Session 84 committed after webhook timeout; queued writers drained in 180 ms and lock waits returned to baseline.",
    },
  ],
});

const ordersIncident: WarehouseIncidentView = buildIncidentCase({
  database: "1".repeat(64),
  dbName: "Orders",
  env: "Production",
  title: "Read-replica WAL replay lag exceeded 18 seconds",
  lifecycle: "active",
  victimSummary:
    "Reporting reads on aurora-orders-ro-1 observed stale order states during bulk fulfillment updates.",
  mechanism:
    "Unbatched UPDATE statements generated 1.4 GB/min of WAL while an idle-in-transaction analytics cursor pinned hot heap pages on the read replica.",
  sql: "UPDATE public.orders SET fulfillment_state = $1, updated_at = now() WHERE batch_id = $2",
  ownerExplanation:
    "Backend PID 19402 held a virtualxid snapshot for 6m 12s, stalling hot-standby replay conflict resolution.",
  action:
    "Chunk fulfillment batch updates to 2,000 rows per transaction and set idle_in_transaction_session_timeout = '30s' on reporting roles.",
  verify:
    "Check Resources & waits → Replication & HA health to confirm replay_lag drops under 500 ms.",
  historySteps: [
    {
      offsetSec: 240,
      lifecycle: "active",
      stepNote:
        "Standby aurora-orders-ro-1 replay lag crossed 5.0 s threshold while write/flush lag remained < 30 ms.",
    },
    {
      offsetSec: 12,
      lifecycle: "active",
      stepNote:
        "Replay lag reached 18.4 s during bulk fulfillment wave; hot-standby feedback reports snapshot conflict with PID 19402.",
    },
  ],
});

const ledgerIncident: WarehouseIncidentView = buildIncidentCase({
  database: "2".repeat(64),
  dbName: "Ledger",
  env: "Production",
  title: "Key-lookup deadlock cycle on dbo.ledger_entries",
  lifecycle: "active",
  victimSummary:
    "Concurrent settlement postings and balance inquiries deadlocked 4 times in 15 minutes.",
  mechanism:
    "Balance readers acquired S locks on ix_ledger_account then requested Key Lookup on pk_ledger_entries while settlement writers acquired X locks in the opposite order.",
  sql: "SELECT account_id, SUM(amount_cents) FROM dbo.ledger_entries WHERE account_id = @acct GROUP BY account_id",
  ownerExplanation:
    "Session 61 updated pk_ledger_entries first and waited on ix_ledger_account, completing a bidirectional lock cycle.",
  action:
    "Create covering index ix_ledger_account INCLUDE (amount_cents, posted_at) to eliminate the Key Lookup.",
  verify:
    "Inspect Resources & waits → Captured deadlock graphs and verify zero new error 1205 victims.",
  historySteps: [
    {
      offsetSec: 310,
      lifecycle: "active",
      stepNote:
        "First key-lookup deadlock captured in system_health ring buffer between settlement-worker and ledger-api.",
    },
    {
      offsetSec: 18,
      lifecycle: "active",
      stepNote:
        "4 recurring deadlock cycles recorded over 15 minutes on pk_ledger_entries ↔ ix_ledger_account.",
    },
  ],
});

export const emptyIncidentView: WarehouseIncidentView = structuredClone(view);
emptyIncidentView.report.incidents = [];
emptyIncidentView.report.history.entries = [];
emptyIncidentView.report.history.limitations = [];

function regionalRows(names: string[], stale = false): WarehouseFleetRow[] {
  return rows
    .filter((row) => names.includes(row.database_name))
    .map((row) => ({
      ...row,
      active_incidents: 0,
      high_findings: stale ? 1 : 0,
      actionable_findings: 2,
      recent_regressions: 0,
      freshness: stale ? ("stale" as const) : ("observed" as const),
    }));
}

export const archives = [
  {
    name: "Demo estate",
    region: "United States",
    revision: "d".repeat(64),
    rows,
    checkout: true,
  },
  {
    name: "eu-production",
    region: "Europe",
    revision: "e".repeat(64),
    rows: regionalRows(["Checkout", "Catalog", "Billing"]),
    checkout: false,
  },
  {
    name: "jp-production",
    region: "Japan",
    revision: "f".repeat(64),
    rows: regionalRows(["Checkout", "Inventory"], true),
    checkout: false,
  },
];

export type DemoArchive = (typeof archives)[number];

export function fleet(
  archive: DemoArchive,
  request: WarehouseFleetRequest,
): WarehouseFleetReport {
  const { filter } = request;
  const selected = archive.rows.filter(
    (row) =>
      (!filter.environment || filter.environment === row.environment) &&
      (!filter.engine || filter.engine === row.engine) &&
      (!filter.attention_only ||
        row.active_incidents > 0 ||
        row.high_findings > 0 ||
        row.freshness !== "observed"),
  );
  if (request.sort === "resource") {
    selected.sort((a, b) => a.database_name.localeCompare(b.database_name));
  }
  return {
    request,
    rows: selected.slice(0, request.page_rows),
    summary: {
      evaluated_resources: selected.length,
      attention_resources: selected.filter(
        (r) =>
          r.active_incidents > 0 ||
          r.high_findings > 0 ||
          r.freshness !== "observed",
      ).length,
      active_incidents: selected.reduce((n, r) => n + r.active_incidents, 0),
      high_finding_resources: selected.filter((r) => r.high_findings > 0)
        .length,
      regression_resources: selected.filter((r) => r.recent_regressions > 0)
        .length,
      stale_or_partial_resources: selected.filter(
        (r) => r.freshness !== "observed",
      ).length,
    },
    next: null,
    discovery_complete: true,
    qualifications: [],
    gaps: [],
    candidate_rows: selected.length,
    archive_work: {
      selected_rows: selected.length,
      queries: 2,
      pages: 1,
      returned_rows: selected.length,
      response_bytes: 4096n,
      proof_bytes: 2048n,
      recovery_objects: 0,
      recovery_bytes: 0n,
    },
    collector_targets: archive.checkout
      ? [
          {
            connection_id: "9f31c4a8e2b10047d5a1c8b3f209e412",
            connection_name: "payments-pci-vault",
            engine: "mssql",
            connection_outcome: "failure",
            original_status: "unavailable",
            original_stop:
              "TLS handshake failed: server certificate expired 14m ago",
            started_at: before(95),
            finished_at: before(94),
            elapsed_ms: 812,
            source_queries: 0,
          },
        ]
      : undefined,
  };
}

function findRowMeta(archive: DemoArchive, dbId: string): WarehouseFleetRow {
  return (
    archive.rows.find((r) => r.selector.database === dbId) ??
    rows.find((r) => r.selector.database === dbId) ??
    rows[0]!
  );
}

export function incidentForResource(
  archive: DemoArchive,
  dbId: string,
): WarehouseIncidentView {
  const rowMeta = findRowMeta(archive, dbId);
  if (!archive.checkout) {
    const empty = structuredClone(emptyIncidentView);
    empty.report.database = dbId;
    empty.report.from = workload.window_start!;
    empty.report.until = around;
    empty.report.recorded_before = around;
    empty.report.discovery_complete = true;
    return empty;
  }
  if (dbId === resource.database) return structuredClone(view);
  if (dbId === "1".repeat(64)) return structuredClone(ordersIncident);
  if (dbId === "2".repeat(64)) return structuredClone(ledgerIncident);

  const empty = structuredClone(emptyIncidentView);
  empty.report.database = dbId;
  empty.report.from = workload.window_start!;
  empty.report.until = around;
  empty.report.recorded_before = around;
  empty.report.discovery_complete = true;
  void rowMeta;
  return empty;
}

function buildWindowTelemetry(
  rowMeta: WarehouseFleetRow,
  fromIso: string,
  untilIso: string,
): WindowTelemetry {
  const dbId = rowMeta.selector.database;
  const fromMs = Date.parse(fromIso);
  const untilMs = Date.parse(untilIso);
  const span = Math.max(untilMs - fromMs, 60_000);
  const steps = 32;
  const isAnalytics =
    rowMeta.database_name === "Customer insights" || dbId === "5".repeat(64);
  const isLedger = dbId === "2".repeat(64);
  const isOrders = dbId === "1".repeat(64);
  const baseCpu = rowMeta.telemetry?.cpu_pct ?? 34;
  const baseMem = rowMeta.telemetry?.memory_pct ?? 58;
  const baseIo = rowMeta.telemetry?.data_io_pct ?? 20;

  const samples = Array.from({ length: steps }, (_, idx) => {
    const t = idx / (steps - 1);
    const wave = Math.sin(t * Math.PI * 3.2) * 4;
    const spike =
      rowMeta.active_incidents > 0
        ? Math.exp(-Math.pow((t - 0.68) / 0.13, 2))
        : Math.exp(-Math.pow((t - 0.45) / 0.22, 2)) * 0.25;
    const cpu = isAnalytics
      ? Math.min(98, Math.round(64 + 28 * t + wave))
      : Math.max(
          8,
          Math.min(
            97,
            Math.round(baseCpu * 0.52 + 48 * spike + wave + (idx % 2) * 2),
          ),
        );
    const mem = Math.max(
      24,
      Math.min(95, Math.round(baseMem - 6 + 10 * spike + Math.sin(t * 4) * 2)),
    );
    const io = Math.max(
      4,
      Math.min(92, Math.round(baseIo * 0.65 + 32 * spike + Math.cos(t * 5) * 3)),
    );
    const log = Math.max(3, Math.round(12 + 26 * spike + (idx % 3)));
    const workers = Math.max(6, Math.round(16 + 42 * spike + (idx % 4)));
    return {
      measurement: null,
      data_io_accounting: "data-files" as const,
      at: new Date(fromMs + t * span).toISOString(),
      cpu_pct: cpu,
      data_io_pct: io,
      log_write_pct: log,
      memory_pct: mem,
      workers_pct: workers,
    };
  });

  const capRef = {
    capture: {
      observation_id: "demo-resource-capture",
      revision: { outbox_id: "demo-outbox", owner_epoch: "1", sequence: "10" },
    },
    manifest_sha256: "a".repeat(64),
    source_scope_id: resource.namespace_id,
  };

  const intervalCount = 24;
  const wait_intervals = Array.from({ length: intervalCount }, (_, idx) => {
    const t = idx / intervalCount;
    const f = new Date(fromMs + t * span).toISOString();
    const u = new Date(fromMs + ((idx + 1) / intervalCount) * span).toISOString();
    const surge =
      rowMeta.active_incidents > 0
        ? 1 + 3.8 * Math.exp(-Math.pow((t - 0.68) / 0.11, 2))
        : 0.85 + 0.35 * Math.sin(t * Math.PI * 2.5);

    return {
      baseline: capRef,
      current: capRef,
      from: f,
      until: u,
      scope: "database" as const,
      read_complete: true,
      waits: isAnalytics
        ? [
            {
              category: "CPU",
              wait_type: "CPU",
              wait_ms: Math.round(2800 * (0.75 + t * 0.5)),
              signal_wait_ms: Math.round(1800 * (0.75 + t * 0.5)),
              waiting_tasks: 240,
              max_wait_ms: 180n,
            },
            {
              category: "IO",
              wait_type: "wait/io/file/innodb/innodb_data_file",
              wait_ms: Math.round(1450 * (0.8 + Math.sin(idx) * 0.15)),
              signal_wait_ms: 90,
              waiting_tasks: 110,
              max_wait_ms: 95n,
            },
          ]
        : rowMeta.engine === "postgres"
          ? [
              {
                category: "IO",
                wait_type: "IO: DataFileRead",
                wait_ms: Math.round(1650 * surge),
                signal_wait_ms: 55,
                waiting_tasks: Math.round(95 * surge),
                max_wait_ms: 210n,
              },
              {
                category: "Log",
                wait_type: "IO: WALSync",
                wait_ms: Math.round(920 * surge),
                signal_wait_ms: 35,
                waiting_tasks: 140,
                max_wait_ms: 68n,
              },
              {
                category: "Lock",
                wait_type: "Lock: transactionid",
                wait_ms: Math.round((isOrders ? 740 : 180) * surge),
                signal_wait_ms: 20,
                waiting_tasks: 28,
                max_wait_ms: 18400n,
              },
              {
                category: "CPU",
                wait_type: "CPU",
                wait_ms: Math.round(520 + (idx % 4) * 60),
                signal_wait_ms: 520,
                waiting_tasks: 180,
                max_wait_ms: 19n,
              },
            ]
          : [
              {
                category: "Lock",
                wait_type: "LCK_M_X",
                wait_ms: Math.round(
                  (rowMeta.active_incidents > 0 ? 2900 : 220) * surge,
                ),
                signal_wait_ms: 45,
                waiting_tasks: Math.round(18 * surge),
                max_wait_ms: 42100n,
              },
              {
                category: "IO",
                wait_type: "PAGEIOLATCH_SH",
                wait_ms: Math.round(860 * (0.9 + (idx % 3) * 0.12)),
                signal_wait_ms: 30,
                waiting_tasks: 85,
                max_wait_ms: 140n,
              },
              {
                category: "Log",
                wait_type: "WRITELOG",
                wait_ms: Math.round(480 * surge * 0.6),
                signal_wait_ms: 22,
                waiting_tasks: 110,
                max_wait_ms: 48n,
              },
              {
                category: "CPU",
                wait_type: "SOS_SCHEDULER_YIELD",
                wait_ms: Math.round(410 + (idx % 5) * 45),
                signal_wait_ms: 410,
                waiting_tasks: 190,
                max_wait_ms: 22n,
              },
            ],
    };
  });

  const blocking =
    dbId === resource.database
      ? partial<BlockingReport>({
          title: "Lock wait chain on checkout.orders",
          summary:
            "Session 84 (payment-worker) held an exclusive key lock while idle in transaction for 42.1 s, blocking 3 checkout writers.",
          blocking: {
            waiting: 3,
            chains: [
              {
                head: "84",
                head_kind: "idle-in-transaction",
                head_ms: 42100,
                transaction_ms: 42850,
                waiters: 3,
                longest_wait_ms: 42100,
                wait_type: "LCK_M_X",
                lock: null,
                headline:
                  "Session 84 (idle in transaction 42.8 s) blocks 3 checkout requests on checkout.orders",
                advice:
                  "Commit or roll back the open transaction in payment-worker before invoking external payment webhooks.",
                tree: {
                  key: "session:84",
                  session: "84",
                  context: partial({
                    id: "84",
                    state: "sleeping (open tx)",
                    application: "payment-worker",
                    user: "svc_checkout",
                    transaction_ms: 42850,
                    sql: "BEGIN TRAN; UPDATE checkout.orders SET payment_intent = @pi WHERE id = @order_id; -- awaiting HTTP webhook",
                  }),
                  lock: null,
                  waits_for: null,
                  children: [
                    {
                      key: "session:112",
                      session: "112",
                      context: partial({
                        id: "112",
                        state: "suspended",
                        wait: "LCK_M_U",
                        wait_ms: 42100,
                        application: "checkout-api",
                        user: "svc_checkout",
                        sql: "UPDATE checkout.orders SET status = @status WHERE id = @order_id",
                      }),
                      lock: null,
                      waits_for: "update lock on checkout.orders (pk_orders)",
                      children: [
                        {
                          key: "session:124",
                          session: "124",
                          context: partial({
                            id: "124",
                            state: "suspended",
                            wait: "LCK_M_S",
                            wait_ms: 19400,
                            application: "order-status-poller",
                            user: "svc_reader",
                            sql: "SELECT status, updated_at FROM checkout.orders WHERE id = @order_id",
                          }),
                          lock: null,
                          waits_for: "shared key lock behind session 112",
                          children: [],
                        },
                      ],
                    },
                    {
                      key: "session:118",
                      session: "118",
                      context: partial({
                        id: "118",
                        state: "suspended",
                        wait: "LCK_M_U",
                        wait_ms: 31800,
                        application: "checkout-api",
                        user: "svc_checkout",
                        sql: "UPDATE checkout.orders SET status = @status WHERE id = @order_id",
                      }),
                      lock: null,
                      waits_for: "update lock on checkout.orders (pk_orders)",
                      children: [],
                    },
                  ],
                },
              },
            ],
          },
        })
      : undefined;

  return {
    resources: [
      {
        original: capRef,
        native_clock: { kind: "interval", from: fromIso, until: untilIso },
        read_complete: true,
        samples,
      },
    ],
    wait_intervals,
    activity: [
      {
        original: capRef,
        native_clock: {
          kind: "observation",
          from: new Date(fromMs + span * 0.68).toISOString(),
          until: new Date(fromMs + span * 0.68).toISOString(),
        },
        read_complete: true,
        active_sessions: isAnalytics ? 28 : rowMeta.active_incidents > 0 ? 19 : 8,
        blocked_sessions:
          dbId === resource.database ? 3 : isLedger ? 2 : 0,
        idle_in_transaction_sessions:
          dbId === resource.database || isOrders ? 1 : 0,
        waiting_on_lock_sessions:
          dbId === resource.database ? 3 : isLedger ? 2 : 0,
        max_elapsed_ms: rowMeta.active_incidents > 0 ? 42850n : 640n,
        max_wait_ms:
          dbId === resource.database ? 42100n : rowMeta.active_incidents > 0 ? 1850n : 42n,
        max_transaction_age_ms: rowMeta.active_incidents > 0 ? 42850n : 910n,
        blocking,
      },
    ],
    deadlocks:
      dbId === resource.database || isLedger ? sampleDeadlocks : [],
    replication:
      rowMeta.engine === "postgres"
        ? [
            {
              original: capRef,
              native_clock: {
                kind: "observation",
                from: untilIso,
                until: untilIso,
              },
              read_complete: true,
              report: partial<ReplicationReport>({
                title: "PostgreSQL streaming replication",
                summary: isOrders
                  ? "1 physical standby observed · 18.4 s replay delay"
                  : "1 physical standby observed · 14 ms replay lag (healthy)",
                entries: [
                  {
                    title: `${rowMeta.connection_alias ?? "pg"}-ro-1 (streaming)`,
                    explanation: isOrders
                      ? "Standby received WAL promptly, but replay lagged behind primary commit LSN during hot-page snapshot pin."
                      : "Streaming physical standby is caught up with primary WAL flush LSN.",
                    conditions: isOrders ? ["replay-paused"] : [],
                    fields: [
                      { key: "write_lag", label: "Write lag", value: "8 ms" },
                      { key: "flush_lag", label: "Flush lag", value: "16 ms" },
                      {
                        key: "replay_lag",
                        label: "Replay lag",
                        value: isOrders ? "18.4 s" : "14 ms",
                      },
                    ],
                  },
                ],
              }),
            },
          ]
        : [],
    node_resources: [
      partial<NodeResources>({
        nodes: [
          {
            node:
              rowMeta.engine === "postgres"
                ? `${rowMeta.shared_group?.label ?? rowMeta.connection_alias}-writer-az1`
                : rowMeta.engine === "mysql"
                  ? `${rowMeta.connection_alias}-primary-01`
                  : "sql-commerce-node-01",
            available: true,
            cpu_user_fraction: (rowMeta.telemetry?.cpu_pct ?? 35) / 100,
            cpu_system_fraction: 0.08,
            host_memory_total_bytes: 68_719_476_736,
            host_memory_available_bytes: isAnalytics
              ? 8_246_337_208
              : 22_548_578_304,
            host_memory_free_bytes: 4_294_967_296,
            process_memory: null,
          },
        ],
      }),
    ],
  };
}

function makeOriginals(fromIso: string, untilIso: string): WindowOriginal[] {
  const families: Array<[string, "interval" | "observation", string]> = [
    ["resource-samples", "interval", "a1f9082c41e0"],
    ["wait-counter-samples", "interval", "b47d190a53c2"],
    ["activity-observations", "observation", "81197ccd5a3e"],
    ["query-runtime", "interval", "c9204e8b71d4"],
    ["query-waits", "interval", "d382a10f9c6b"],
    ["database-settings", "observation", "1924dec05136"],
    ["schema-catalog", "observation", "e7510bc492a8"],
  ];
  return families.map(([name, kind, prefix], idx) => ({
    original: {
      capture: {
        observation_id: `cap-${name}-${idx}`,
        revision: {
          outbox_id: "collector-shard-01",
          owner_epoch: "4",
          sequence: String(100 + idx),
        },
      },
      manifest_sha256: (prefix + "0".repeat(64)).slice(0, 64),
      source_scope_id: resource.namespace_id,
    },
    collection: name as WindowOriginal["collection"],
    native_clock: {
      kind,
      from:
        kind === "interval"
          ? fromIso
          : new Date(
              Date.parse(fromIso) +
                (Date.parse(untilIso) - Date.parse(fromIso)) * 0.85,
            ).toISOString(),
      until: untilIso,
    },
    read_complete: true,
  }));
}

function populatePublishedAnalysis(
  basePub: WindowPublishedAnalysis,
  rowMeta: WarehouseFleetRow,
  fromIso: string,
  untilIso: string,
): WindowPublishedAnalysis {
  const pub = structuredClone(basePub);
  pub.limitations = [];
  pub.read_complete = true;
  pub.native_window_qualified = true;
  pub.native_clock = { kind: "interval", from: fromIso, until: untilIso };
  pub.rules = { kind: "matches-current-builtin" };
  pub.context.description.rules_version = "0.6.2";
  pub.context.description.display = {
    connection_alias:
      rowMeta.connection_alias ?? rowMeta.database_name.toLowerCase(),
    environment: rowMeta.environment,
    database_name: rowMeta.database_name,
  };
  pub.context.description.finding_evaluations = {
    checks: [
      "missing_indexes",
      "duplicate_indexes",
      "unused_indexes",
      "foreign_key_indexes",
      "stale_statistics",
      "heap_or_bloat_health",
      "isolation_and_locking_posture",
      "parallelism_threshold",
      "memory_grant_pressure",
      "autovacuum_or_maintenance",
      "backup_recency",
      "connection_saturation",
    ].map((chk, idx) => ({
      check: chk,
      status: idx < 3 ? ("findings" as const) : ("assessed" as const),
      reason: null,
      missing: [],
      assessed_queries: 16,
    })),
    assessments: [],
    assessment_count: 12,
    omitted_assessments: 0,
  };

  const baseFindingWrap = pub.findings[0]!;
  const baseChangeWrap = pub.changes[0]!;
  const midIso = new Date(
    (Date.parse(fromIso) + Date.parse(untilIso)) / 2,
  ).toISOString();
  const earlyIso = new Date(
    Date.parse(fromIso) + (Date.parse(untilIso) - Date.parse(fromIso)) * 0.28,
  ).toISOString();

  const makeFinding = (
    id: string,
    category: Finding["category"],
    severity: Finding["severity"],
    title: string,
    summary: string,
    metrics: Array<[string, string]>,
    fixSummary: string,
    fixSql: string,
    verify: string[],
  ): WindowPublishedFinding => {
    const clone = structuredClone(baseFindingWrap);
    clone.placement = {
      time: { kind: "originals", inputs: [] },
      overlaps_window: true,
      read_complete: true,
      qualification: "",
    };
    clone.finding.display = pub.context.description.display;
    clone.finding.finding = partial<Finding>({
      id,
      check: id.split(":")[0] ?? "check",
      category,
      severity,
      confidence: "high",
      title,
      summary,
      metrics: metrics.map(([label, text]) => ({
        label,
        value: 0,
        unit: "count",
        text,
      })),
      fix: { summary: fixSummary, sql: fixSql, cost: null },
      verify,
      caveats: [],
      queries: [],
      inactive: false,
    });
    return clone;
  };

  const makeChange = (
    id: string,
    kind: WindowPublishedChange["change"]["change"]["kind"],
    at: string,
    title: string,
    detail: string,
    object: string | null = null,
    jobStatus?: "succeeded" | "failed",
  ): WindowPublishedChange => {
    const clone = structuredClone(baseChangeWrap);
    clone.placement = {
      time: { kind: "recorded-change", at, after: fromIso, until: null },
      overlaps_window: true,
      read_complete: true,
      qualification: "",
    };
    clone.change.display = pub.context.description.display;
    clone.change.change = {
      ...clone.change.change,
      id,
      kind,
      at,
      after: fromIso,
      until: null,
      object,
      title: { text: title },
      detail: { text: detail },
      job_execution: jobStatus
        ? partial<JobExecutionEvent>({ status: jobStatus })
        : null,
    };
    return clone;
  };

  if (rowMeta.engine === "mssql") {
    const firstSchema = structuredClone(baseFindingWrap);
    firstSchema.placement = {
      time: { kind: "originals", inputs: [] },
      overlaps_window: true,
      read_complete: true,
      qualification: "",
    };
    firstSchema.finding.finding = indexFinding;

    pub.findings = [
      firstSchema,
      makeFinding(
        "covering_index:shop.customers",
        "indexes",
        rowMeta.active_incidents > 0 ? "high" : "medium",
        "Key lookup on shop.customers (ix_customers_email) drives 151× plan regression and lock cycles",
        "Queries filtering by email perform 1,200 key lookups per window into PK_customers to fetch name and segment, escalating lock duration and triggering read/write deadlocks.",
        [
          ["DB time share", "18.4%"],
          ["Logical reads", "1.07M pages"],
          ["Est. cost reduction", "99.3%"],
        ],
        "Extend ix_customers_email with INCLUDE (name, segment) online so customer lookups become pure index seeks without touching PK_customers.",
        "CREATE NONCLUSTERED INDEX [ix_customers_email_covering]\nON [shop].[customers] ([email])\nINCLUDE ([name], [segment])\nWITH (ONLINE = ON, SORT_IN_TEMPDB = ON);",
        [
          "Confirm execution plan for Query ID 142 uses Index Seek without Key Lookup.",
          "Verify logical reads per execution drop from 890 to <= 4 pages.",
        ],
      ),
      makeFinding(
        "rcsi_disabled:database",
        "posture",
        "high",
        "READ_COMMITTED_SNAPSHOT is OFF — readers acquire shared locks and block behind writers",
        "Under default locking Read Committed isolation, status-polling SELECT queries request LCK_M_S locks on checkout.orders and queue behind open writer transactions.",
        [
          ["Lock wait share", "76.6%"],
          ["Peak blocked sessions", "3"],
          ["Longest reader wait", "19.4 s"],
        ],
        "Enable READ_COMMITTED_SNAPSHOT so SELECT statements read consistent row versions from tempdb without taking shared key locks.",
        "ALTER DATABASE CURRENT SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE;",
        [
          "Verify is_read_committed_snapshot_on = 1 in sys.databases.",
          "Confirm LCK_M_S waits disappear from Wait class breakdown.",
        ],
      ),
      makeFinding(
        "cost_threshold_parallelism:server",
        "configuration",
        "medium",
        "Cost threshold for parallelism is left at SQL Server's 1998 default (5)",
        "Short OLTP lookups with subtree cost > 5 spawn parallel exchange operators, inflating CXPACKET / CXCONSUMER waits and worker thread consumption.",
        [
          ["Current setting", "5"],
          ["Recommended baseline", "50"],
          ["Parallelism wait", "13.6 s"],
        ],
        "Raise cost threshold for parallelism to 50 so only genuine analytical scans go parallel.",
        "EXEC sys.sp_configure N'show advanced options', 1;\nRECONFIGURE;\nEXEC sys.sp_configure N'cost threshold for parallelism', 50;\nRECONFIGURE;",
        [
          "Monitor SOS_SCHEDULER_YIELD and Parallelism waits over the next 24h.",
        ],
      ),
    ];

    pub.changes = [
      makeChange(
        "chg:qs-policy",
        "setting",
        untilIso,
        "Query Store capture policy changed",
        "QUERY_CAPTURE_MODE transitioned from ALL to AUTO during the selected window.",
      ),
      makeChange(
        "chg:stats-orders",
        "statistics",
        midIso,
        "Auto-updated statistics on shop.order_items (_WA_Sys_00000003)",
        "Sampled 24.8% of 1,500,000 rows after modification counter crossed threshold.",
        "shop.order_items",
      ),
      makeChange(
        "chg:job-index-maint",
        "job-execution",
        earlyIso,
        "SQL Agent job IndexOptimize - USER_DATABASES completed",
        "Rebuilt 2 fragmented partitions and updated 11 column statistics online in 14.2 s.",
        "IndexOptimize",
        "succeeded",
      ),
    ];
    return pub;
  }

  if (rowMeta.engine === "postgres") {
    pub.findings = [
      makeFinding(
        "missing_fk_index:public.order_items",
        "indexes",
        "high",
        "Unindexed filter & foreign key on public.order_items (warehouse_id, allocated_at)",
        "Fulfillment allocation scans 480K heap pages per minute on public.order_items because no partial B-tree index covers unallocated items per warehouse.",
        [
          ["DB time share", "24.1%"],
          ["Heap blocks read", "38,900 / run"],
          ["Est. speedup", "42×"],
        ],
        "Create a partial covering B-tree index concurrently on unallocated warehouse rows.",
        "CREATE INDEX CONCURRENTLY idx_order_items_unallocated_wh\nON public.order_items (warehouse_id, product_id)\nINCLUDE (quantity)\nWHERE allocated_at IS NULL;",
        [
          "Run EXPLAIN (ANALYZE, BUFFERS) and confirm Index Only Scan on idx_order_items_unallocated_wh.",
          "Check pg_stat_user_indexes.idx_scan increases on production traffic.",
        ],
      ),
      makeFinding(
        "btree_bloat:public.orders",
        "indexes",
        "medium",
        "B-tree index idx_orders_updated_at has 48% dead-page bloat after bulk updates",
        "Frequent fulfillment_state updates left sparse leaf pages in idx_orders_updated_at, doubling buffer cache footprint and WAL volume.",
        [
          ["Index size", "3.4 GiB"],
          ["Estimated bloat", "48% (1.6 GiB)"],
          ["Cache hit ratio", "91.2%"],
        ],
        "Rebuild the bloated index concurrently during low-write window to reclaim 1.6 GiB of shared buffers.",
        "REINDEX INDEX CONCURRENTLY public.idx_orders_updated_at;",
        [
          "Confirm pg_relation_size('public.idx_orders_updated_at') drops below 1.9 GiB.",
        ],
      ),
      makeFinding(
        "autovacuum_scale_factor:public.orders",
        "maintenance",
        rowMeta.database_name === "Orders" ? "high" : "medium",
        "Default autovacuum_vacuum_scale_factor (0.20) lags behind high-churn public.orders updates",
        "With 12M rows in public.orders, autovacuum waits for 2.4M dead tuples before triggering, causing heap bloat and hot-standby replay conflicts.",
        [
          ["Dead tuples", "1.84M"],
          ["Current scale factor", "0.20"],
          ["Recommended", "0.02"],
        ],
        "Lower table-level autovacuum scale factor to 2% with dedicated cost limit on public.orders.",
        "ALTER TABLE public.orders SET (\n  autovacuum_vacuum_scale_factor = 0.02,\n  autovacuum_analyze_scale_factor = 0.01,\n  autovacuum_vacuum_cost_limit = 2000\n);",
        [
          "Verify n_dead_tup stays below 250K in pg_stat_user_tables.",
        ],
      ),
      makeFinding(
        "idle_in_tx_timeout:role",
        "posture",
        "medium",
        "idle_in_transaction_session_timeout is disabled (0) on application & analytics roles",
        "Idle open transactions pin XMIN horizons and block WAL replay on read replicas.",
        [
          ["Current timeout", "0 (disabled)"],
          ["Oldest idle tx", "6m 12s"],
        ],
        "Set a bounded 30-second idle-in-transaction timeout at the database level.",
        "ALTER DATABASE orders SET idle_in_transaction_session_timeout = '30s';",
        [
          "Check SHOW idle_in_transaction_session_timeout returns 30s on new sessions.",
        ],
      ),
    ];

    pub.changes = [
      makeChange(
        "chg:pg-index-create",
        "index",
        midIso,
        "Created index idx_outbox_events_pending concurrently",
        "Added partial index on public.outbox_events (created_at) WHERE published_at IS NULL.",
        "public.outbox_events",
      ),
      makeChange(
        "chg:pg-setting-workmem",
        "setting",
        earlyIso,
        "Parameter work_mem increased from 4MB to 16MB",
        "Applied via parameter group reload to reduce external sort temp files.",
      ),
    ];
    return pub;
  }

  // MySQL findings & changes
  pub.findings = [
    makeFinding(
      "composite_index:analytics.events",
      "indexes",
      "high",
      "Full partition scan on analytics.events due to non-sargable DATE(occurred_at) grouping",
      "Tenant rollup queries scan 18.4M InnoDB pages per hour because idx_events_occurred lacks leading tenant_id column.",
      [
        ["CPU share", "68.2%"],
        ["Rows examined / call", "2.4M"],
        ["Est. cost reduction", "94%"],
      ],
      "Add composite index (tenant_id, occurred_at, revenue_micros) inplace with LOCK=NONE.",
      "ALTER TABLE analytics.events\nADD INDEX idx_events_tenant_occurred_rev (tenant_id, occurred_at, revenue_micros),\nALGORITHM=INPLACE, LOCK=NONE;",
      [
        "Confirm EXPLAIN shows range access using idx_events_tenant_occurred_rev with Using index.",
      ],
    ),
    makeFinding(
      "buffer_pool_pressure:innodb",
      "configuration",
      "medium",
      "InnoDB buffer pool read requests show 6.8% disk miss rate under analytics scans",
      "Buffer pool (40 GiB) churns hot OLTP shipment pages when hourly rollups run concurrently.",
      [
        ["Buffer pool utilization", "98.4%"],
        ["Disk read ratio", "6.8%"],
        ["Old-blocks pct", "37%"],
      ],
      "Protect young LRU pages by tuning innodb_old_blocks_time = 1000 and sizing buffer pool to 75% of host RAM.",
      "SET PERSIST innodb_old_blocks_time = 1000;",
      [
        "Verify Innodb_buffer_pool_reads / Innodb_buffer_pool_read_requests drops below 1%.",
      ],
    ),
  ];

  pub.changes = [
    makeChange(
      "chg:mysql-stats",
      "statistics",
      midIso,
      "InnoDB persistent statistics recalculated on fulfillment.shipments",
      "ANALYZE TABLE updated cardinality estimates across 4 secondary indexes.",
      "fulfillment.shipments",
    ),
    makeChange(
      "chg:mysql-setting",
      "setting",
      earlyIso,
      "Updated innodb_io_capacity_max from 2000 to 6000",
      "Increased background dirty-page flushing ceiling on NVMe storage.",
    ),
  ];
  return pub;
}

function buildWorkloadComparison(
  engine: Engine,
  fromIso: string,
  untilIso: string,
): Changes {
  if (engine === "postgres") {
    return partial<Changes>({
      engine: "postgres",
      summary: "Bulk fulfillment updates increased WAL sync waits by 3.4× compared to the prior interval.",
      unchanged: 14,
      notes: [],
      events: [],
      queries: [
        partial({
          query_id: "pg-q1",
          text: "UPDATE public.orders SET fulfillment_state = $1, updated_at = now() WHERE batch_id = $2",
          status: "regressed",
          ratio: 3.4,
          impact_ms: 58400,
          recent_share: 0.42,
          same_plan: true,
          headline: "UPDATE public.orders mean latency rose 3.4× (13.7 ms → 46.8 ms)",
          reason: "Unbatched 25K-row transactions saturated WALSync I/O and conflicted with standby replay.",
          context: [],
        }),
      ],
    });
  }
  if (engine === "mysql") {
    return partial<Changes>({
      engine: "mysql",
      summary: "Tenant rollup query CPU time grew 2.6× as partition cardinality increased.",
      unchanged: 11,
      notes: [],
      events: [],
      queries: [
        partial({
          query_id: "my-q1",
          text: "SELECT tenant_id, DATE(occurred_at) AS d, COUNT(*) FROM analytics.events ...",
          status: "regressed",
          ratio: 2.6,
          impact_ms: 87200,
          recent_share: 0.61,
          same_plan: true,
          headline: "Tenant analytics rollup cost +87.2 s additional CPU time (2.6× slower)",
          reason: "Missing composite (tenant_id, occurred_at) index forced full partition scan.",
          context: [],
        }),
      ],
    });
  }
  void fromIso;
  void untilIso;
  return partial<Changes>({
    engine: "mssql",
    summary: "2 statements regressed significantly due to parameter-sniffed scan flip and lock contention.",
    unchanged: 14,
    notes: [],
    events: [],
    queries: [
      partial({
        query_id: "138",
        text: "UPDATE [shop].[orders] SET [status] = [status] WHERE [id]=@1",
        status: "regressed",
        ratio: 48.2,
        impact_ms: 112400,
        recent_share: 0.34,
        same_plan: true,
        headline: "UPDATE shop.orders mean latency jumped from 12 ms to 28,743 ms (lock contention)",
        reason: "Blocked behind idle-in-transaction Session 84 holding LCK_M_X on pk_orders.",
        context: [],
      }),
      partial({
        query_id: "142",
        text: "SELECT [id], [name], [segment] FROM [shop].[customers] WHERE [email] = @P1",
        status: "regressed",
        ratio: 46.2,
        impact_ms: 21680,
        recent_share: 0.14,
        same_plan: false,
        headline: "SELECT shop.customers switched from plan-4102 (Seek) to plan-4189 (Scan · 151.4× cost)",
        reason: "Parameter-sniffed recompile replaced covering seek with scan + key lookup.",
        context: [],
      }),
    ],
  });
}

export function sampleWindow(
  archive: DemoArchive,
  request: WarehouseWindowQuery,
): WarehouseWindowReport {
  const rowMeta = findRowMeta(archive, request.resource.database);
  const report = warehouseWindowCase(request, "Checkout index usage changed");
  report.next = null;
  report.discovery_complete = true;
  report.gaps = [];
  report.qualifications = ["Illustrative archive for the local demo."];

  const matchedIncident = incidentForResource(
    archive,
    request.resource.database,
  );
  report.incidents = structuredClone(matchedIncident.report);
  report.incidents.from = request.window.from;
  report.incidents.until = request.window.until;
  report.incidents.recorded_before = request.as_of;
  report.incident_limitations = [];

  report.telemetry = buildWindowTelemetry(
    rowMeta,
    request.window.from,
    request.window.until,
  );

  report.originals = makeOriginals(request.window.from, request.window.until);

  const from = Date.parse(request.window.from);
  const until = Date.parse(request.window.until);
  const published = Date.parse(request.as_of);

  if (archive.checkout && request.resource.database === resource.database) {
    const observedIncident = (
      entry: (typeof view.report.history.entries)[number],
    ) =>
      Date.parse(entry.recorded_at) <= published &&
      Date.parse(entry.first_seen_at) < until &&
      Date.parse(entry.last_seen_at) >= from;
    report.incidents.incidents = report.incidents.incidents.filter((item) =>
      observedIncident(item.entry),
    );
    report.incidents.history.entries =
      report.incidents.history.entries.filter(observedIncident);

    if (published < Date.parse(around)) {
      report.published = [];
      return report;
    }
    const fullReport =
      from <= Date.parse(workload.window_start!) &&
      until >= Date.parse(around);
    const hasReportTime =
      from < Date.parse(around) && until >= Date.parse(around);
    if (!hasReportTime) {
      report.published = [];
    } else if (report.published[0]) {
      report.published = [
        populatePublishedAnalysis(
          report.published[0],
          rowMeta,
          request.window.from,
          request.window.until,
        ),
      ];
    }

    if (request.view === "compatible-workload" && !fullReport) {
      report.qualifications.push(
        "The demo contains one archived Top SQL report. Its statement rankings cover the full captured window.",
      );
      return report;
    }
  } else if (report.published[0]) {
    report.published = [
      populatePublishedAnalysis(
        report.published[0],
        rowMeta,
        request.window.from,
        request.window.until,
      ),
    ];
  }

  if (request.view === "compatible-workload") {
    const engineWorkload = buildEngineWorkload(rowMeta.engine, workload);
    report.workload = {
      kind: "evaluated",
      analysis: partial<CollectedQueryWindowAnalysis>({
        sections: [
          {
            analysis_id: `sample-${rowMeta.engine}-${rowMeta.database_name.toLowerCase()}`,
            scope_id:
              rowMeta.selector.database === resource.database
                ? "9f4c2b81e0a4" + resource.namespace_id.slice(12)
                : rowMeta.selector.database,
            native_scope_qualified: true,
            population: {
              kind: "population",
              identity: { id: engineWorkload.source, qualifiers: {} },
            },
            observed: {
              from:
                rowMeta.selector.database === resource.database
                  ? workload.window_start!
                  : request.window.from,
              until:
                rowMeta.selector.database === resource.database
                  ? around
                  : request.window.until,
            },
            analysis: {
              runtime_totals: {
                executions: String(engineWorkload.total_executions),
                query_identities: String(engineWorkload.query_count),
              },
              workload: engineWorkload,
              limitations: [],
            },
            comparison: {
              rules_version: "0.6.2",
              baseline_inputs: [],
              recent_inputs: [],
              changes: buildWorkloadComparison(
                rowMeta.engine,
                request.window.from,
                request.window.until,
              ),
              gaps: [],
            },
            context_issues: [],
          },
        ],
        gaps: [],
      }),
    };
  }
  return report;
}

export function sampleArtifacts(
  archive: DemoArchive,
  query: WarehouseArtifactQuery,
) {
  void archive;
  const topPlan = workload.queries.find((q) => q.plan != null)?.plan ?? null;
  const report = warehouseArtifactCase(
    query,
    "COMPLETE_RETAINED_BODY",
    topPlan,
  );
  for (const record of report.records) {
    for (const item of record.artifacts) {
      if (
        item.kind === "sql" &&
        item.payload.kind === "complete" &&
        item.payload.payload.state === "available"
      ) {
        item.payload.payload.text =
          "UPDATE checkout.orders SET status = @status WHERE id = @order_id";
      }
    }
  }
  report.qualifications = ["Verified original record from object recovery."];
  return report;
}

function flattenPlan(root: PlanNode): PlanNode[] {
  const out: PlanNode[] = [];
  const walk = (n: PlanNode) => {
    out.push(n);
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}

export function computeDemoPlanDiff(
  a: Plan,
  b: Plan,
  nameA: string,
  nameB: string,
): PlanDiff {
  const nodesA = flattenPlan(a.root);
  const nodesB = flattenPlan(b.root);
  const usedB = new Set<number>();
  const matches: { a: number; b: number }[] = [];
  const changes: PlanChange[] = [];

  for (const na of nodesA) {
    const exact = nodesB.find(
      (nb) => !usedB.has(nb.id) && nb.object === na.object && nb.op === na.op,
    );
    if (exact) {
      usedB.add(exact.id);
      matches.push({ a: na.id, b: exact.id });
      continue;
    }
    const sameObj =
      na.object != null
        ? nodesB.find((nb) => !usedB.has(nb.id) && nb.object === na.object)
        : undefined;
    if (sameObj) {
      usedB.add(sameObj.id);
      changes.push({
        kind: "access",
        a: na.id,
        b: sameObj.id,
        title: `${na.object}: ${na.op} → ${sameObj.op}`,
        detail: `${nameA} accessed ${na.object} via ${na.op}${na.index ? ` (${na.index})` : ""}, whereas ${nameB} switched to ${sameObj.op}.`,
        weight: 0.9,
      });
    }
  }

  const matchedA = new Set(matches.map((m) => m.a));
  const only_a = nodesA.filter((n) => !matchedA.has(n.id)).map((n) => n.id);
  const only_b = nodesB.filter((n) => !usedB.has(n.id)).map((n) => n.id);

  const ratio =
    a.total_cost > 0 && b.total_cost > 0 ? b.total_cost / a.total_cost : null;
  const headlines: string[] = [];
  if (ratio !== null && Math.abs(ratio - 1) > 0.05) {
    headlines.push(
      ratio > 1
        ? `${nameB} is ${ratio.toFixed(1)}× higher estimated cost than ${nameA}`
        : `${nameB} reduces estimated cost by ${(1 / ratio).toFixed(1)}× vs ${nameA}`,
    );
  }
  if (changes.length > 0) {
    headlines.push(changes[0]!.title);
  } else if (only_a.length === 0 && only_b.length === 0) {
    headlines.push("Both plans share the same operator tree");
  }

  return {
    headlines,
    cost_a: a.total_cost,
    cost_b: b.total_cost,
    cost_ratio: ratio,
    time_a_ms: a.root.act_time_ms,
    time_b_ms: b.root.act_time_ms,
    comparable: a.engine === b.engine,
    same_shape:
      only_a.length === 0 && only_b.length === 0 && changes.length === 0,
    changes,
    matches,
    only_a,
    only_b,
    warnings_added: b.warnings,
    warnings_removed: a.warnings,
    regions: matches.length
      ? [{ a: matches.map((m) => m.a), b: matches.map((m) => m.b) }]
      : [],
    scenarios:
      changes.length > 0
        ? [
            {
              kind: "parameters",
              title:
                "Parameter sensitivity shifted access path from seek to scan",
              detail:
                "A skewed parameter compiled a scan whose per-execution logical reads grew by two orders of magnitude.",
              a: changes[0]!.a,
              b: changes[0]!.b,
            },
          ]
        : [],
  };
}
