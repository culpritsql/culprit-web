import { ChartNoAxesColumnIncreasing, Layers3 } from "lucide-react";
import type { WarehouseFleetRow } from "../../vendor/culprit/app/src/gen/WarehouseFleetRow";
import type { WarehouseFleetFreshness } from "../../vendor/culprit/app/src/gen/WarehouseFleetFreshness";
import w from "./en.json";

export function FleetCharts({ rows }: { rows: WarehouseFleetRow[] }) {
  if (rows.length === 0) return null;
  const coverage = new Map<WarehouseFleetFreshness, number>();
  for (const row of rows)
    coverage.set(row.freshness, (coverage.get(row.freshness) ?? 0) + 1);
  const groups = [...coverage].sort(([a], [b]) => a.localeCompare(b));
  const busiest = rows
    .filter((row) => row.active_incidents > 0)
    .sort((a, b) => b.active_incidents - a.active_incidents)
    .slice(0, 3);
  return (
    <section className="chart-grid" aria-label={w.pageIncidents}>
      <figure className="panel fleet-chart">
        <figcaption>
          <ChartNoAxesColumnIncreasing size={17} />
          {w.pageIncidents}
        </figcaption>
        <small>{w.shown}</small>
        <ol className="rank-list">
          {busiest.map((row) => (
            <li key={row.resource_id}>
              <span>{row.database_name}</span>
              <div className="track" aria-hidden="true">
                <i
                  style={{
                    width:
                      (100 * row.active_incidents) /
                        busiest[0].active_incidents +
                      "%",
                  }}
                />
              </div>
              <b>{row.active_incidents}</b>
            </li>
          ))}
        </ol>
        {!busiest.length && <p className="muted">{w.noActive}</p>}
      </figure>
      <figure className="panel fleet-chart">
        <figcaption>
          <Layers3 size={17} />
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
              {w.states[state]} <b>{count}</b>
            </li>
          ))}
        </ul>
      </figure>
    </section>
  );
}
