import { useCallback, useState } from "react";
import { ArrowRight, Globe2, RefreshCw } from "lucide-react";
import { api, useRead, type WarehouseConnectionRef } from "./api";
import { fleetRequest } from "./fleetRequest";
import { archiveUrl } from "./navigation";
import { stamp } from "./shared";
import w from "./en.json";

const PAGE_SIZE = 3;
type Region = {
  connection: WarehouseConnectionRef;
  region?: string;
  asOf: string;
};

function ArchiveSummary({ connection, region, asOf }: Region) {
  const read = useCallback(
    (signal: AbortSignal) =>
      api.fleet(connection, fleetRequest(asOf, 1), signal),
    [connection, asOf],
  );
  const result = useRead(read);
  const report = result.status === "ready" ? result.value : null;
  return (
    <article className="panel region-card">
      <header>
        <small>{region || w.unassignedRegion}</small>
        <h2>{connection.name}</h2>
      </header>
      {report ? (
        <>
          <dl>
            {[
              [w.resources, report.summary.evaluated_resources],
              [w.incidents, report.summary.active_incidents],
              [w.coverage, report.summary.stale_or_partial_resources],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {!report.discovery_complete && (
            <p className="notice">{w.partialArchive}</p>
          )}
        </>
      ) : (
        <p role={result.status === "error" ? "alert" : "status"}>
          {result.status === "error" ? result.message : w.loading}
        </p>
      )}
      <a href={archiveUrl(connection.name)}>
        {w.openFleet}
        <ArrowRight size={14} />
      </a>
    </article>
  );
}

export function RegionalFleet({
  connections,
  regions,
}: {
  connections: WarehouseConnectionRef[];
  regions: Record<string, string>;
}) {
  const [page, setPage] = useState(0);
  const [asOf, setAsOf] = useState(() => new Date().toISOString());
  const start = page * PAGE_SIZE;
  return (
    <>
      <header className="page-head">
        <div>
          <h1>{w.regionalFleet}</h1>
          <p>
            <Globe2 size={15} /> {w.regionalIntro} · {stamp(asOf)}
          </p>
        </div>
        <button
          className="button"
          onClick={() => setAsOf(new Date().toISOString())}
        >
          <RefreshCw size={15} />
          {w.refresh}
        </button>
      </header>
      {connections.length ? (
        <div className="region-grid">
          {connections.slice(start, start + PAGE_SIZE).map((connection) => (
            <ArchiveSummary
              key={connection.name}
              connection={connection}
              region={regions[connection.name]}
              asOf={asOf}
            />
          ))}
        </div>
      ) : (
        <p className="notice">{w.noRegionalFleets}</p>
      )}
      {connections.length > PAGE_SIZE && (
        <footer className="table-foot">
          <span>
            {w.pages} {page + 1}
          </span>
          <div>
            <button
              className="button"
              disabled={!page}
              onClick={() => setPage(page - 1)}
            >
              {w.prev}
            </button>
            <button
              className="button"
              disabled={start + PAGE_SIZE >= connections.length}
              onClick={() => setPage(page + 1)}
            >
              {w.next}
            </button>
          </div>
        </footer>
      )}
    </>
  );
}
