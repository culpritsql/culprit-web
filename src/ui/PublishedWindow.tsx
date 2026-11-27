import { useCallback, useState } from "react";
import type { IncidentReadReport } from "../../vendor/culprit/app/src/gen/IncidentReadReport";
import type { PublishedResourceCursor } from "../../vendor/culprit/app/src/gen/PublishedResourceCursor";
import {
  api,
  useRead,
  useReadDefaults,
  type PublishedResourceSelector,
  type WarehouseConnectionRef,
} from "./api";
import { PublishedAnalysis, type PublishedArea } from "./PublishedAnalysis";
import { StateMessage, stamp } from "./shared";
import w from "./en.json";

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
          view: "published-answers",
          page_rows: pageRows,
          after,
        },
        signal,
      ),
    [connection, resource, report, after, pageRows],
  );
  const result = useRead(load);
  if (result.status !== "ready")
    return (
      <StateMessage
        error={result.status === "error" ? result.message : undefined}
      />
    );
  const page = result.value;
  return (
    <section className="panel case">
      <h2>
        {area === "changes"
          ? w.published
          : area === "schema"
            ? w.schema
            : w.operations}
      </h2>
      <p>
        {stamp(report.from)} — {stamp(report.until)}
      </p>
      {page.published.length === 0 && <p>{w.noPublished}</p>}
      {page.published.map((analysis) => (
        <PublishedAnalysis
          key={analysis.context.capture.manifest_sha256}
          analysis={analysis}
          area={area}
          scope={{ resource, connection }}
        />
      ))}
      {!page.discovery_complete && <p>{w.partial}</p>}
      {[...page.gaps.map((g) => g.kind), ...page.qualifications].map(
        (reason, i) => (
          <p className="muted" key={i}>
            {reason}
          </p>
        ),
      )}
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
