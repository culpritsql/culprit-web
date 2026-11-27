import { useCallback, useState } from "react";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Database,
  Layers3,
  Radio,
  RefreshCw,
} from "lucide-react";
import type { WarehouseFleetCursor } from "../../vendor/culprit/app/src/gen/WarehouseFleetCursor";
import { api, useRead, type WarehouseConnectionRef } from "./api";
import { fleetRequest } from "./fleetRequest";
import { FleetCharts } from "./FleetCharts";
import { investigationUrl } from "./navigation";
import type { PublishedResourceSelector } from "./api";
import { StateMessage, stamp } from "./shared";
import engines from "../../vendor/culprit/app/src/gen/engines.json";
import w from "./en.json";

export function Fleet({
  connection,
  canInspect,
}: {
  connection: WarehouseConnectionRef;
  canInspect: (resource: PublishedResourceSelector) => boolean;
}) {
  const [asOf, setAsOf] = useState(() => new Date().toISOString());
  const [attention, setAttention] = useState(false);
  const [cursors, setCursors] = useState<(WarehouseFleetCursor | null)[]>([
    null,
  ]);
  const after = cursors[cursors.length - 1];
  const load = useCallback(
    (signal: AbortSignal) =>
      api.fleet(connection, fleetRequest(asOf, 20, attention, after), signal),
    [connection, asOf, attention, after],
  );
  const data = useRead(load);
  const report = data.status === "ready" ? data.value : null;
  const summary = report?.summary;
  const metrics = [
    { label: w.resources, value: summary?.evaluated_resources, icon: Database },
    { label: w.incidents, value: summary?.active_incidents, icon: Radio },
    {
      label: w.attention,
      value: summary?.attention_resources,
      icon: CircleAlert,
    },
    {
      label: w.coverage,
      value: summary?.stale_or_partial_resources,
      icon: Layers3,
    },
  ];
  return (
    <>
      <header className="page-head">
        <div>
          <h1>{w.overview}</h1>
          <p>{w.subheading}</p>
        </div>
        <button
          className="button"
          onClick={() => {
            setCursors([null]);
            setAsOf(new Date().toISOString());
          }}
        >
          <RefreshCw size={15} />
          {w.refresh}
        </button>
      </header>
      <section className="metrics" aria-label={w.summary}>
        {metrics.map((m) => (
          <div className="metric" key={m.label}>
            <span>
              <m.icon size={16} />
              {m.label}
            </span>
            <strong>{m.value ?? "—"}</strong>
          </div>
        ))}
      </section>
      {report && <FleetCharts rows={report.rows} />}
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{w.table}</h2>
            <small>
              {w.asof} {stamp(asOf)}
            </small>
          </div>
          <div className="switcher">
            {[false, true].map((value) => (
              <button
                key={String(value)}
                aria-pressed={attention === value}
                onClick={() => {
                  setAttention(value);
                  setCursors([null]);
                }}
              >
                {value ? w.attentionOnly : w.all}
              </button>
            ))}
          </div>
        </div>
        {report ? (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{w.database}</th>
                    <th>{w.engine}</th>
                    <th>{w.freshness}</th>
                    <th>{w.incidents}</th>
                    <th>{w.findings}</th>
                    <th>{w.observed}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => {
                    const href = investigationUrl(
                      connection,
                      row.selector,
                      row.latest_observed_until ?? row.latest_collected_until,
                    );
                    return (
                      <tr key={row.resource_id}>
                        <td>
                          {canInspect(row.selector) ? (
                            <a className="db-link" href={href}>
                              {row.database_name}
                              <ArrowRight size={14} />
                            </a>
                          ) : (
                            <strong>{row.database_name}</strong>
                          )}
                          <small>
                            {row.environment ?? row.connection_alias}
                          </small>
                        </td>
                        <td>{engines[row.engine].label}</td>
                        <td>
                          <span className={"status " + row.freshness}>
                            <i />
                            {w.states[row.freshness]}
                          </span>
                        </td>
                        <td>{row.active_incidents}</td>
                        <td>{row.high_findings}</td>
                        <td className="timestamp">
                          {stamp(row.latest_collected_until)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!report.rows.length && <div className="notice">{w.noRows}</div>}
            <footer className="table-foot">
              <span>
                {w.pages} {cursors.length} · {report.rows.length}{" "}
                {w.shown.toLowerCase()}
              </span>
              <div>
                <button
                  className="button"
                  disabled={cursors.length === 1}
                  onClick={() => setCursors((v) => v.slice(0, -1))}
                >
                  <ChevronLeft size={14} />
                  {w.prev}
                </button>
                <button
                  className="button"
                  disabled={!report.next}
                  onClick={() => {
                    if (report.next) setCursors((v) => [...v, report.next]);
                  }}
                >
                  {w.next}
                  <ChevronRight size={14} />
                </button>
              </div>
            </footer>
          </>
        ) : (
          <StateMessage
            error={data.status === "error" ? data.message : undefined}
          />
        )}
      </section>
      {report &&
        (!report.discovery_complete ||
          report.gaps.length > 0 ||
          report.qualifications.length > 0) && (
          <aside className="notice notes">
            <strong>{w.reason}</strong>
            {!report.discovery_complete && <span>{w.partial}</span>}
            {[...report.gaps.map((g) => g.kind), ...report.qualifications].map(
              (v, i) => (
                <span key={i}>{v}</span>
              ),
            )}
          </aside>
        )}
    </>
  );
}
