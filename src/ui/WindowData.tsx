import { useCallback } from "react";
import type { IncidentReadReport } from "../../vendor/culprit/app/src/gen/IncidentReadReport";
import type { WindowOriginal } from "../../vendor/culprit/app/src/gen/WindowOriginal";
import {
  api,
  useRead,
  useReadDefaults,
  type WarehouseConnectionRef,
  type PublishedResourceSelector,
} from "./api";
import { StateMessage, stamp } from "./shared";
import { Workload } from "./Workload";
import w from "./en.json";

function Coverage({ originals }: { originals: WindowOriginal[] }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <h2>{w.nativeCoverage}</h2>
          <small>{w.coverageExplanation}</small>
        </div>
      </header>
      {originals.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {[w.dataset, w.clock, w.first, w.last, w.readStatus].map(
                  (label) => (
                    <th key={label}>{label}</th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {originals.map((row, i) => (
                <tr key={i}>
                  <td>
                    {typeof row.collection === "string"
                      ? row.collection
                      : row.collection.snapshot}
                  </td>
                  <td>{row.native_clock.kind}</td>
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
                  <td>{row.read_complete ? w.complete : w.states.partial}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="notice">{w.noOriginals}</p>
      )}
    </section>
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
  report: IncidentReadReport;
  view: "workload" | "coverage";
}) {
  const { window_page_rows } = useReadDefaults();
  const load = useCallback(
    (signal: AbortSignal) =>
      api.window(
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
      ),
    [connection, resource, report, window_page_rows],
  );
  const result = useRead(load);
  if (result.status !== "ready")
    return (
      <StateMessage
        error={result.status === "error" ? result.message : undefined}
      />
    );
  const data = result.value;
  return (
    <>
      {view === "workload" ? (
        <Workload workload={data.workload} />
      ) : (
        <Coverage originals={data.originals} />
      )}
      {!data.discovery_complete && <p className="notice">{w.partial}</p>}
      {[...data.gaps.map((gap) => gap.kind), ...data.qualifications].map(
        (reason, i) => (
          <p className="muted" key={i}>
            {reason}
          </p>
        ),
      )}
    </>
  );
}
