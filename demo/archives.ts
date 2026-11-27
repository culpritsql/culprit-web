import { around, indexFinding, resource, rows, view, workload } from "./estate";
import { warehouseWindowCase } from "../vendor/culprit/app/src/test/warehouse-windows";
import type { WarehouseWindowQuery } from "../vendor/culprit/app/src/gen/WarehouseWindowQuery";
import type { WarehouseFleetRequest } from "../vendor/culprit/app/src/gen/WarehouseFleetRequest";

export const emptyIncidentView = structuredClone(view);
emptyIncidentView.report.incidents = [];
emptyIncidentView.report.history.entries = [];

function regionalRows(names: string[], stale = false) {
  return rows
    .filter((row) => names.includes(row.database_name))
    .map((row) => ({
      ...row,
      active_incidents: 0,
      high_findings: 0,
      actionable_findings: 0,
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
type DemoArchive = (typeof archives)[number];
export function fleet(archive: DemoArchive, request: WarehouseFleetRequest) {
  const { filter } = request;
  const selected = archive.rows.filter(
    (row) =>
      (!filter.environment || filter.environment === row.environment) &&
      (!filter.engine || filter.engine === row.engine) &&
      (!filter.attention_only ||
        row.active_incidents ||
        row.high_findings ||
        row.freshness !== "observed"),
  );
  if (request.sort === "resource")
    selected.sort((a, b) => a.database_name.localeCompare(b.database_name));
  return {
    request,
    rows: selected.slice(0, request.page_rows),
    summary: {
      evaluated_resources: selected.length,
      attention_resources: selected.filter(
        (r) =>
          r.active_incidents || r.high_findings || r.freshness !== "observed",
      ).length,
      active_incidents: selected.reduce((n, r) => n + r.active_incidents, 0),
      high_finding_resources: selected.filter((r) => r.high_findings).length,
      regression_resources: 0,
      stale_or_partial_resources: selected.filter(
        (r) => r.freshness !== "observed",
      ).length,
    },
    next: null,
    discovery_complete: true,
    qualifications: [],
    gaps: [],
  };
}
export function sampleWindow(
  archive: DemoArchive,
  request: WarehouseWindowQuery,
) {
  const report = warehouseWindowCase(request, "Checkout index usage changed");
  report.next = null;
  report.discovery_complete = true;
  report.incidents = structuredClone(view.report);
  report.incidents.from = request.window.from;
  report.incidents.until = request.window.until;
  report.incidents.recorded_before = request.as_of;
  report.incident_limitations = [];
  report.qualifications = ["Illustrative archive for the local demo."];
  if (!archive.checkout || request.resource.database !== resource.database) {
    report.incidents.incidents = [];
    report.incidents.history.entries = [];
    report.published = [];
    return report;
  }
  for (const pub of report.published) {
    for (const item of pub.findings) item.finding.finding = indexFinding;
    for (const item of pub.changes) {
      item.change.change.title.text = "Query Store capture policy changed";
      item.change.change.detail.text =
        "The capture mode changed during the selected interval.";
    }
  }
  if (request.view === "compatible-workload")
    Object.assign(report, {
      workload: {
        kind: "evaluated",
        analysis: {
          sections: [
            {
              analysis_id: "sample-query-store",
              scope_id: resource.namespace_id,
              native_scope_qualified: true,
              population: {
                kind: "population",
                identity: { id: workload.source, qualifiers: {} },
              },
              observed: { from: workload.window_start, until: around },
              analysis: {
                runtime_totals: {
                  executions: String(workload.total_executions),
                  query_identities: String(workload.query_count),
                },
                workload,
                limitations: [],
              },
              comparison: { changes: null, gaps: [] },
            },
          ],
          gaps: [],
        },
      },
    });
  return report;
}
