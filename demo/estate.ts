import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { WarehouseFleetRow } from "../vendor/culprit/app/src/gen/WarehouseFleetRow";
import type { WarehouseIncidentView } from "../vendor/culprit/app/src/gen/WarehouseIncidentView";
import type { Workload } from "../vendor/culprit/app/src/gen/Workload";

const sampleReport = JSON.parse(
  await readFile("vendor/culprit/fixtures/mssql-demo.report.json", "utf8"),
);
const sample = sampleReport.snapshot;
export const indexFinding = sampleReport.findings.find(
  (f: { category: string }) => f.category === "indexes",
);
export const workload: Workload = sample.workload;
export const around = sample.taken_at;
const before = (seconds: number) =>
  new Date(Date.parse(around) - seconds * 1000).toISOString();
export const resource = {
  namespace_id: "a".repeat(64),
  database: "b".repeat(64),
};
const entries: [
  string,
  WarehouseFleetRow["engine"],
  string,
  number,
  number,
  WarehouseFleetRow["freshness"],
][] = [
  ["Checkout", "mssql", "Production", 3, 2, "observed"],
  ["Orders", "postgres", "Production", 2, 1, "observed"],
  ["Ledger", "mssql", "Production", 1, 0, "partial"],
  ["Fulfillment", "mysql", "Production", 0, 1, "stale"],
  ["Catalog", "postgres", "Production", 0, 0, "observed"],
  ["Customer insights", "mysql", "Analytics", 0, 0, "observed"],
  ["Inventory", "postgres", "Staging", 0, 0, "observed"],
  ["Billing", "mssql", "Staging", 0, 0, "observed"],
];
export const rows: WarehouseFleetRow[] = entries.map(
  ([name, engine, environment, active, high, freshness], i) => {
    const at = before(freshness === "stale" ? 7200 : i * 14);
    return {
      resource_id: name,
      selector: i
        ? { ...resource, database: i.toString(16).repeat(64) }
        : resource,
      database_name: name,
      engine,
      environment,
      active_incidents: active,
      high_findings: high,
      freshness,
      connection_alias: name.toLowerCase(),
      shared_group: null,
      latest_collected_from: at,
      latest_collected_until: at,
      latest_observed_from: at,
      latest_observed_until: at,
      uncertain_incidents: 0,
      actionable_findings: high,
      recent_regressions: 0,
      recent_changes: 0,
      input_read_complete: freshness !== "partial",
      limitations: [],
    };
  },
);

function incidentScenario(): WarehouseIncidentView {
  const script =
    'import { warehouseIncidentCase } from "./vendor/culprit/app/src/test/warehouse-incidents"; console.log(JSON.stringify(warehouseIncidentCase(),(_,v)=>typeof v==="bigint"?v.toString():v));';
  const view: WarehouseIncidentView = JSON.parse(
    execFileSync("bun", ["-e", script], { encoding: "utf8" }),
  );
  const { report } = view;
  report.from = workload.window_start!;
  report.until = around;
  report.recorded_before = around;
  report.discovery_complete = true;
  const episode = report.incidents[0];
  episode.entry.title = "Checkout requests waited on an open transaction";
  Object.assign(episode.entry, {
    first_seen_at: before(126),
    last_seen_at: before(84),
    recorded_at: before(70),
    lifecycle: "resolved",
  });
  report.history.entries = [structuredClone(episode.entry)];
  episode.display.database_name = "Checkout";
  episode.display.environment = "Production";
  episode.victim_summary =
    "Checkout writes waited for 42 seconds while a session held a lock on the orders table.";
  episode.mechanism =
    "The wait chain linked the checkout request to session 84. The owner was idle in an open transaction.";
  const waiter = episode.affected_queries[0];
  if (waiter.sql.state === "available")
    waiter.sql.text =
      "UPDATE checkout.orders SET status = @status WHERE id = @order_id";
  episode.candidate_queries = [];
  episode.culprit_queries[0].causal_role!.explanation.text =
    "Session 84 owned the blocking lock. Its earlier statement was outside the captured interval.";
  episode.developer_action =
    "Trace the transaction boundary in the payment worker and close the transaction before the network call.";
  episode.verification =
    "Repeat the checkout and compare lock waits in the next captured window.";
  view.analysis_limitations = [];
  return view;
}
export const view = incidentScenario();
