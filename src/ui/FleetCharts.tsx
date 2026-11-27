import {
  ChartNoAxesColumnIncreasing,
  Cpu,
  Layers3,
} from "lucide-react";
import type { WarehouseFleetRow } from "../../vendor/culprit/app/src/gen/WarehouseFleetRow";
import type { WarehouseFleetFreshness } from "../../vendor/culprit/app/src/gen/WarehouseFleetFreshness";
import { EngineBadge } from "./EngineBadge";
import w from "./en.json";

export function FleetCharts({ rows }: { rows: WarehouseFleetRow[] }) {
  if (rows.length === 0) return null;
  const coverage = new Map<WarehouseFleetFreshness, number>();
  for (const row of rows)
    coverage.set(row.freshness, (coverage.get(row.freshness) ?? 0) + 1);
  const groups = [...coverage].sort(([a], [b]) => a.localeCompare(b));

  const busiest = [...rows]
    .filter((row) => row.active_incidents > 0 || row.high_findings > 0)
    .sort(
      (a, b) =>
        b.active_incidents - a.active_incidents ||
        b.high_findings - a.high_findings,
    )
    .slice(0, 4);
  const maxSignal = busiest.length
    ? Math.max(
        1,
        ...busiest.map((r) => r.active_incidents + r.high_findings),
      )
    : 1;

  const saturated = [...rows]
    .filter(
      (row) =>
        row.telemetry?.cpu_pct != null || row.telemetry?.memory_pct != null,
    )
    .sort(
      (a, b) =>
        Math.max(b.telemetry?.cpu_pct ?? 0, b.telemetry?.memory_pct ?? 0) -
        Math.max(a.telemetry?.cpu_pct ?? 0, a.telemetry?.memory_pct ?? 0),
    )
    .slice(0, 4);

  return (
    <section
      className={`chart-grid ${saturated.length ? "chart-grid-3" : ""}`}
      aria-label={w.pageIncidents}
    >
      <figure className="panel fleet-chart">
        <figcaption>
          <ChartNoAxesColumnIncreasing size={16} />
          {w.pageIncidents}
        </figcaption>
        <small>{w.shown}</small>
        {busiest.length ? (
          <ol className="rank-list">
            {busiest.map((row) => {
              const score = row.active_incidents + row.high_findings;
              return (
                <li key={row.resource_id}>
                  <span className="rank-db">
                    <EngineBadge engine={row.engine} compact />
                    <span>{row.database_name}</span>
                  </span>
                  <div className="track" aria-hidden="true">
                    <i
                      className={
                        row.active_incidents > 0 ? "bar-danger" : "bar-warn"
                      }
                      style={{
                        width: `${Math.max(8, (100 * score) / maxSignal)}%`,
                      }}
                    />
                  </div>
                  <b>
                    {row.active_incidents > 0
                      ? `${row.active_incidents} inc`
                      : `${row.high_findings} high`}
                  </b>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="muted chart-empty">{w.noActive}</p>
        )}
      </figure>

      {saturated.length > 0 && (
        <figure className="panel fleet-chart">
          <figcaption>
            <Cpu size={16} />
            Compute &amp; memory pressure
          </figcaption>
          <small>Peak resource utilization across observed targets</small>
          <ol className="rank-list util-rank-list">
            {saturated.map((row) => {
              const cpu = Math.round(row.telemetry?.cpu_pct ?? 0);
              const mem = Math.round(row.telemetry?.memory_pct ?? 0);
              const peak = Math.max(cpu, mem);
              return (
                <li key={row.resource_id}>
                  <span className="rank-db">
                    <EngineBadge engine={row.engine} compact />
                    <span>{row.database_name}</span>
                  </span>
                  <div className="dual-bars" aria-hidden="true">
                    <span className="dual-track" title={`CPU ${cpu}%`}>
                      <i
                        className={peak >= 85 ? "bar-danger" : "bar-accent"}
                        style={{ width: `${Math.min(100, cpu)}%` }}
                      />
                    </span>
                    <span className="dual-track" title={`Memory ${mem}%`}>
                      <i
                        className="bar-mem"
                        style={{ width: `${Math.min(100, mem)}%` }}
                      />
                    </span>
                  </div>
                  <b>
                    {cpu}% / {mem}%
                  </b>
                </li>
              );
            })}
          </ol>
        </figure>
      )}

      <figure className="panel fleet-chart">
        <figcaption>
          <Layers3 size={16} />
          {w.collectionCoverage}
        </figcaption>
        <small>{w.shown}</small>
        <div className="segments" aria-hidden="true">
          {groups.map(([state, count]) => (
            <i
              key={state}
              className={"swatch " + state}
              style={{ flex: count }}
            />
          ))}
        </div>
        <ul className="legend">
          {groups.map(([state, count]) => (
            <li key={state}>
              <i className={"swatch " + state} />
              <span>{w.states[state]}</span> <b>{count}</b>
            </li>
          ))}
        </ul>
      </figure>
    </section>
  );
}
