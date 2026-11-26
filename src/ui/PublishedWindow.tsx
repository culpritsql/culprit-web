import { useCallback, useState } from "react";
import type { IncidentReadReport } from "../../vendor/culprit/app/src/gen/IncidentReadReport";
import type { PublishedResourceCursor } from "../../vendor/culprit/app/src/gen/PublishedResourceCursor";
import { api, useRead, type PublishedResourceSelector, type WarehouseConnectionRef } from "./api";
import { StateMessage, stamp } from "./shared";
import w from "./en.json";

export function PublishedWindow({
  connection,
  resource,
  report,
}: {
  connection: WarehouseConnectionRef;
  resource: PublishedResourceSelector;
  report: IncidentReadReport;
}) {
  const [cursors, setCursors] = useState<(PublishedResourceCursor | null)[]>([null]);
  const after = cursors[cursors.length - 1];
  const load = useCallback(
    (signal: AbortSignal) =>
      api.window(
        connection,
        {
          resource,
          window: { from: report.from, until: report.until },
          as_of: report.recorded_before,
          view: "published-answers",
          page_rows: 10,
          after,
        },
        signal,
      ),
    [connection, resource, report, after],
  );
  const result = useRead(load);
  if (result.status !== "ready")
    return <StateMessage error={result.status === "error" ? result.message : undefined} />;
  const page = result.value;
  return (
    <section className="panel case">
      <h2>{w.published}</h2>
      <p>
        {stamp(report.from)} — {stamp(report.until)}
      </p>
      {page.published.length === 0 && <p>{w.noPublished}</p>}
      {page.published.map((analysis) => (
        <article key={analysis.context.capture.manifest_sha256}>
          <h3>
            {w.publishedAt} · {stamp(analysis.context.description.recorded_at)}
          </h3>
          {analysis.findings.map(({ finding, placement }) => (
            <div key={finding.finding.id}>
              <strong>{finding.finding.title}</strong>
              <p>{finding.finding.summary}</p>
              <small>{placement.qualification}</small>
            </div>
          ))}
          {analysis.changes.map(({ change, placement }) => (
            <div key={change.change.id}>
              <strong>{change.change.title.text}</strong>
              {change.change.detail && <p>{change.change.detail.text}</p>}
              <small>{placement.qualification}</small>
            </div>
          ))}
          {analysis.limitations.map((reason, i) => (
            <p className="muted" key={i}>
              {reason}
            </p>
          ))}
        </article>
      ))}
      {!page.discovery_complete && <p>{w.partial}</p>}
      {[...page.gaps.map((g) => g.kind), ...page.qualifications].map((reason, i) => (
        <p className="muted" key={i}>
          {reason}
        </p>
      ))}
      <footer className="table-foot">
        <span>
          {w.pages} {cursors.length}
        </span>
        <div>
          <button
            className="button"
            disabled={cursors.length === 1}
            onClick={() => setCursors((v) => v.slice(0, -1))}
          >
            {w.prev}
          </button>
          <button
            className="button"
            disabled={!page.next}
            onClick={() => {
              if (page.next) setCursors((v) => [...v, page.next]);
            }}
          >
            {w.next}
          </button>
        </div>
      </footer>
    </section>
  );
}
