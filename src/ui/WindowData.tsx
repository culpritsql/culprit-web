import { useCallback } from "react";
import { CheckCircle2, Database, Layers3, ShieldCheck } from "lucide-react";
import type { IncidentReadReport } from "../../vendor/culprit/app/src/gen/IncidentReadReport";
import type { WindowOriginal } from "../../vendor/culprit/app/src/gen/WindowOriginal";
import {
  api,
  useRead,
  useReadDefaults,
  type WarehouseConnectionRef,
  type PublishedResourceSelector,
} from "./api";
import { MissionTimeline } from "./MissionTimeline";
import { useLiveTick } from "./livePulse";
import { ResourcesView } from "./ResourcesView";
import { StateMessage, humanizeGap, stamp } from "./shared";
import { Workload } from "./Workload";
import { w } from "./i18n";

export function Coverage({
  originals,
  range,
}: {
  originals: WindowOriginal[];
  range: Pick<IncidentReadReport, "from" | "until">;
}) {
  const startMs = Date.parse(range.from);
  const endMs = Date.parse(range.until);
  const spanMs = Math.max(endMs - startMs, 1);
  const completeCount = originals.filter((o) => o.read_complete).length;

  return (
    <>
      <section className="metrics metrics-3">
        <div className="metric">
          <span>
            <Layers3 size={15} />
            Captured families
          </span>
          <strong>{originals.length}</strong>
        </div>
        <div className="metric">
          <span>
            <CheckCircle2 size={15} />
            Complete reads
          </span>
          <strong>
            {originals.length
              ? `${completeCount} / ${originals.length}`
              : "0"}
          </strong>
        </div>
        <div className="metric">
          <span>
            <ShieldCheck size={15} />
            Manifest integrity
          </span>
          <strong>{originals.length ? "SHA-256 verified" : "—"}</strong>
        </div>
      </section>

      <section className="panel">
        <header className="panel-head">
          <div className="panel-head-copy">
            <h2 className="icon-heading">
              <Database size={18} />
              {w.nativeCoverage}
            </h2>
            <small>{w.coverageExplanation}</small>
          </div>
        </header>
        {originals.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{w.dataset}</th>
                  <th>{w.clock}</th>
                  <th>Window span</th>
                  <th>{w.first}</th>
                  <th>{w.last}</th>
                  <th>Manifest</th>
                  <th>{w.readStatus}</th>
                </tr>
              </thead>
              <tbody>
                {originals.map((row, i) => {
                  const label =
                    typeof row.collection === "string"
                      ? row.collection
                      : row.collection.snapshot;
                  const fMs =
                    row.native_clock.kind === "unknown"
                      ? startMs
                      : Math.max(startMs, Date.parse(row.native_clock.from));
                  const uMs =
                    row.native_clock.kind === "unknown"
                      ? startMs
                      : Math.min(endMs, Date.parse(row.native_clock.until));
                  const leftPct = Math.max(
                    0,
                    Math.min(96, ((fMs - startMs) / spanMs) * 100),
                  );
                  const widthPct =
                    row.native_clock.kind === "unknown"
                      ? 0
                      : Math.max(
                          4,
                          Math.min(100 - leftPct, ((uMs - fMs) / spanMs) * 100),
                        );

                  return (
                    <tr key={i}>
                      <td>
                        <code>{label}</code>
                      </td>
                      <td>
                        <span className="case-meta-pill">
                          {row.native_clock.kind}
                        </span>
                      </td>
                      <td>
                        <div className="coverage-gantt-track" aria-hidden="true">
                          {widthPct > 0 && (
                            <i
                              style={{
                                left: `${leftPct}%`,
                                width: `${widthPct}%`,
                              }}
                            />
                          )}
                        </div>
                      </td>
                      <td>
                        {row.native_clock.kind === "unknown"
                          ? "—"
                          : stamp(row.native_clock.from)}
                      </td>
                      <td>
                        {row.native_clock.kind === "unknown"
                          ? "—"
                          : stamp(row.native_clock.until)}
                      </td>
                      <td>
                        <code className="sha-pill">
                          {row.original.manifest_sha256.slice(0, 10)}
                        </code>
                      </td>
                      <td>
                        <span
                          className={
                            row.read_complete
                              ? "status observed"
                              : "status partial"
                          }
                        >
                          <i />
                          {row.read_complete ? w.complete : w.states.partial}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="notice">{w.noOriginals}</p>
        )}
      </section>
    </>
  );
}

export function WindowData({
  connection,
  resource,
  report,
  view,
}: {
  connection: WarehouseConnectionRef;
  resource: PublishedResourceSelector;
  report: Pick<IncidentReadReport, "from" | "until" | "recorded_before">;
  view: "workload" | "coverage" | "resources";
}) {
  const { window_page_rows } = useReadDefaults();
  const liveTick = useLiveTick();
  const load = useCallback(
    (signal: AbortSignal) => {
      void liveTick;
      return api.window(
        connection,
        {
          resource,
          window: { from: report.from, until: report.until },
          as_of: report.recorded_before,
          view: "compatible-workload",
          page_rows: window_page_rows,
          after: null,
        },
        signal,
      );
    },
    [
      connection,
      resource,
      report.from,
      report.until,
      report.recorded_before,
      window_page_rows,
      liveTick,
    ],
  );
  const result = useRead(
    load,
    `window:${connection.name}:${resource.database}:${view}`,
  );
  if (result.status !== "ready")
    return (
      <StateMessage
        error={result.status === "error" ? result.message : undefined}
      />
    );
  const data = result.value;
  return (
    <>
      <MissionTimeline
        windowReport={data}
        incidentReport={data.incidents}
        range={report}
      />
      {view === "workload" ? (
        <Workload workload={data.workload} range={report} />
      ) : view === "resources" ? (
        <ResourcesView data={data} />
      ) : (
        <Coverage originals={data.originals} range={report} />
      )}
      {!data.discovery_complete && <p className="notice">{w.partial}</p>}
      {[
        ...data.gaps.map((gap) => humanizeGap(gap.kind)),
        ...data.qualifications.filter(
          (q) => q !== "Illustrative archive for the local demo.",
        ),
      ].map((reason, i) => (
        <p className="muted" key={i}>
          {reason}
        </p>
      ))}
    </>
  );
}
