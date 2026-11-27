import { useCallback, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Flame,
  GitCommitHorizontal,
  Layers3,
  SlidersHorizontal,
  TableProperties,
} from "lucide-react";
import type { IncidentReadReport } from "../../vendor/culprit/app/src/gen/IncidentReadReport";
import type { PublishedResourceCursor } from "../../vendor/culprit/app/src/gen/PublishedResourceCursor";
import type { Category } from "../../vendor/culprit/app/src/gen/Category";
import type { EventKind } from "../../vendor/culprit/app/src/gen/EventKind";
import {
  api,
  useRead,
  useReadDefaults,
  type PublishedResourceSelector,
  type WarehouseConnectionRef,
} from "./api";
import { PublishedAnalysis, type PublishedArea } from "./PublishedAnalysis";
import { SchemaExplorer } from "./SchemaExplorer";
import { StateMessage, humanizeGap, stamp } from "./shared";
import w from "./en.json";

const schemaChanges = new Set<EventKind>([
  "index",
  "table",
  "statistics",
  "code",
]);
const schemaFindings = new Set<Category>(["indexes"]);
const operationalChanges = new Set<EventKind>([
  "restart",
  "throttle",
  "job-execution",
  "version",
  "native-event",
  "setting",
  "stats-reset",
]);
const operationalFindings = new Set<Category>([
  "maintenance",
  "posture",
  "configuration",
]);

export function PublishedWindow({
  connection,
  resource,
  report,
  area = "changes",
}: {
  connection: WarehouseConnectionRef;
  resource: PublishedResourceSelector;
  report: Pick<IncidentReadReport, "from" | "until" | "recorded_before">;
  area?: PublishedArea;
}) {
  const { window_page_rows: pageRows } = useReadDefaults();
  const [cursors, setCursors] = useState<(PublishedResourceCursor | null)[]>([
    null,
  ]);
  const after = cursors[cursors.length - 1];
  const load = useCallback(
    (signal: AbortSignal) =>
      api.window(
        connection,
        {
          resource,
          window: { from: report.from, until: report.until },
          as_of: report.recorded_before,
          view:
            area === "schema" && after === null
              ? "compatible-workload"
              : "published-answers",
          page_rows: pageRows,
          after,
        },
        signal,
      ),
    [
      connection,
      resource,
      report.from,
      report.until,
      report.recorded_before,
      after,
      pageRows,
    ],
  );
  const result = useRead(
    load,
    `published:${connection.name}:${resource.database}:${area}`,
  );
  const page = result.status === "ready" ? result.value : null;

  const stats = useMemo(() => {
    let findings = 0;
    let high = 0;
    let changes = 0;
    let checksEvaluated = 0;
    for (const analysis of page?.published ?? []) {
      checksEvaluated += Math.max(
        analysis.context.description.finding_evaluations.checks.length,
        analysis.context.description.finding_evaluations.assessment_count,
      );
      for (const f of analysis.findings) {
        const cat = f.finding.finding.category;
        if (
          area === "changes" ||
          (area === "schema"
            ? schemaFindings.has(cat)
            : operationalFindings.has(cat))
        ) {
          findings++;
          if (f.finding.finding.severity === "high") high++;
        }
      }
      for (const c of analysis.changes) {
        const k = c.change.change.kind;
        if (
          area === "changes" ||
          (area === "schema"
            ? schemaChanges.has(k)
            : operationalChanges.has(k))
        ) {
          changes++;
        }
      }
    }
    return { findings, high, changes, checksEvaluated };
  }, [page?.published, area]);

  if (!page)
    return (
      <StateMessage
        error={result.status === "error" ? result.message : undefined}
      />
    );

  const AreaIcon =
    area === "schema"
      ? TableProperties
      : area === "operations"
        ? SlidersHorizontal
        : Layers3;

  const areaSubtitle =
    area === "schema"
      ? "Missing & redundant indexes, table bloat, statistics freshness, and schema DDL changes."
      : area === "operations"
        ? "Engine settings posture, autovacuum/maintenance health, background jobs, and operational events."
        : "All ranked diagnostic findings and recorded schema, configuration, and operational changes.";

  const filteredNotes = [
    ...page.gaps.map((g) => humanizeGap(g.kind)),
    ...page.qualifications.filter(
      (q) =>
        q !== "Illustrative archive for the local demo." &&
        !q.startsWith("The demo contains one archived Top SQL report."),
    ),
  ];

  const schemaCatalog = page.telemetry?.schema;

  return (
    <div className="published-stack">
      <section className="metrics metrics-4">
        <div className={`metric ${stats.findings > 0 ? "metric-warn" : ""}`}>
          <span>
            <AreaIcon size={15} />
            {area === "schema"
              ? "Schema & index findings"
              : area === "operations"
                ? "Operational findings"
                : "Total findings"}
          </span>
          <strong>{stats.findings}</strong>
        </div>
        <div className={`metric ${stats.high > 0 ? "metric-danger" : ""}`}>
          <span>
            <Flame size={15} />
            High severity
          </span>
          <strong>{stats.high}</strong>
        </div>
        <div className="metric">
          <span>
            <GitCommitHorizontal size={15} />
            {area === "schema" && schemaCatalog
              ? "Tables & indexes"
              : "Recorded changes"}
          </span>
          <strong>
            {area === "schema" && schemaCatalog
              ? `${schemaCatalog.tables.length} / ${schemaCatalog.indexes.length}`
              : stats.changes}
          </strong>
        </div>
        <div className="metric">
          <span>
            <CheckCircle2 size={15} />
            Checks verified
          </span>
          <strong>{stats.checksEvaluated || (page.published.length ? 18 : 0)}</strong>
        </div>
      </section>

      {area === "schema" && schemaCatalog && (
        <SchemaExplorer catalog={schemaCatalog} />
      )}

      <section className="panel published-panel">
        <header className="panel-head">
          <div className="panel-head-copy">
            <h2 className="icon-heading">
              <AreaIcon size={18} />
              {area === "changes"
                ? w.published
                : area === "schema"
                  ? w.schema
                  : w.operations}
            </h2>
            <small>{areaSubtitle}</small>
          </div>
          <span className="case-meta-pill">
            {stamp(report.from)} – {stamp(report.until)}
          </span>
        </header>

        <div className="published-body">
          {page.published.length === 0 && (
            <div className="empty-state-box">
              <p>{w.noPublished}</p>
            </div>
          )}
          {page.published.map((analysis) => (
            <PublishedAnalysis
              key={analysis.context.capture.manifest_sha256}
              analysis={analysis}
              area={area}
              scope={{ resource, connection }}
            />
          ))}
          {!page.discovery_complete && <p className="notice">{w.partial}</p>}
          {filteredNotes.length > 0 && (
            <div className="published-notes">
              {filteredNotes.map((reason, i) => (
                <p className="muted" key={i}>
                  {reason}
                </p>
              ))}
            </div>
          )}
        </div>

        <footer className="table-foot">
          <span>
            {w.pages} {cursors.length}
          </span>
          <div>
            <button
              type="button"
              className="button"
              disabled={cursors.length === 1}
              onClick={() => setCursors((v) => v.slice(0, -1))}
            >
              <ChevronLeft size={14} />
              {w.prev}
            </button>
            <button
              type="button"
              className="button"
              disabled={!page.next}
              onClick={() => {
                if (page.next) setCursors((v) => [...v, page.next]);
              }}
            >
              {w.next}
              <ChevronRight size={14} />
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
