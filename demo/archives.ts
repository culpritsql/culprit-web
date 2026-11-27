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
  const from = Date.parse(request.window.from);
  const until = Date.parse(request.window.until);
  const published = Date.parse(request.as_of);
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
    from <= Date.parse(workload.window_start!) && until >= Date.parse(around);
  const hasReportTime =
    from < Date.parse(around) && until >= Date.parse(around);
  if (!hasReportTime) report.published = [];
  if (report.incidents.incidents.length) {
    const episode = report.incidents.incidents[0];
    report.originals = episode.affected_queries[0].evidence.map((ref) => ({
      original: {
        capture: ref.capture,
        manifest_sha256: ref.manifest_sha256,
        source_scope_id: ref.source_scope_id,
      },
      collection: "activity",
      native_clock: {
        kind: "observation",
        from: episode.entry.first_seen_at,
        until: episode.entry.last_seen_at,
      },
      read_complete: true,
    }));
  }
  for (const pub of report.published) {
    for (const item of pub.findings) item.finding.finding = indexFinding;
    for (const item of pub.changes) {
      item.change.change.title.text = "Query Store capture policy changed";
      item.change.change.detail.text =
        "The capture mode changed during the selected interval.";
    }
  }
  if (request.view === "compatible-workload" && !fullReport) {
    report.qualifications.push(
      "The demo contains one archived Top SQL report. Its statement rankings cover the full captured window.",
    );
    return report;
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
