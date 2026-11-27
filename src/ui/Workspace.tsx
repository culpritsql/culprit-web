import { RegionalFleet } from "./RegionalFleet";
import { Database, ChevronRight } from "lucide-react";
import {
  api,
  ExportAccess,
  useRead,
  type Session,
  type ArchiveAccess,
  type PublishedResourceSelector,
} from "./api";
import { SavedViews } from "./SavedViews";
import { Fleet } from "./Fleet";
import { Incident } from "./Incident";
import { StateMessage } from "./shared";
import {
  archiveUrl,
  investigationUrl,
  activeSection,
  getRange,
} from "./navigation";
import w from "./en.json";

export function mayInspect(
  access: ArchiveAccess,
  selected: PublishedResourceSelector,
) {
  return (
    access.inspect_evidence ||
    access.resources.some(
      (r) =>
        r.inspect_evidence &&
        r.selector.namespace_id === selected.namespace_id &&
        r.selector.database === selected.database,
    )
  );
}

export function Workspace({
  access,
  savedEnabled,
  regions,
}: {
  savedEnabled: boolean;
  regions: Record<string, string>;
  access: NonNullable<Session["access"]>;
}) {
  const result = useRead(api.connections);
  if (result.status !== "ready")
    return (
      <StateMessage
        error={result.status === "error" ? result.message : undefined}
      />
    );
  const params = new URLSearchParams(location.search);
  const name = params.get("archive");
  const revision = params.get("revision");
  const connections = result.value;
  const fleetArchives = connections.filter(
    (item) => access.archives[item.name]?.view_fleet,
  );
  const overview =
    !name &&
    !revision &&
    !params.has("database") &&
    (params.get("view") === "regions" ||
      (params.size === 0 && fleetArchives.length > 1));
  if (overview)
    return <RegionalFleet connections={fleetArchives} regions={regions} />;
  const candidates = connections.filter((item) =>
    name ? item.name === name : item.revision === revision,
  );
  const connection =
    name || revision
      ? candidates.length === 1
        ? candidates[0]
        : undefined
      : connections[0];
  if (!connection || !Object.hasOwn(access.archives, connection.name))
    return <StateMessage error={w.badLink} />;
  const grant = access.archives[connection.name];
  const resource = {
    namespace_id: params.get("namespace") ?? "",
    database: params.get("database") ?? "",
  };
  const investigating = params.has("database");
  const selectedRange = getRange(params);
  if (selectedRange === "invalid")
    return <StateMessage error={w.invalidRange} />;
  const around = params.get("around") ?? "";
  if (
    investigating &&
    (revision !== connection.revision ||
      ![resource.namespace_id, resource.database].every((s) =>
        /^[a-f0-9]{64}$/.test(s),
      ) ||
      !Number.isFinite(Date.parse(around)))
  )
    return <StateMessage error={w.badLink} />;
  if (investigating && !mayInspect(grant, resource))
    return <StateMessage error={w.role} />;
  const allowExport =
    grant.export_evidence ||
    grant.resources.some(
      (r) =>
        r.export_evidence &&
        r.selector.namespace_id === resource.namespace_id &&
        r.selector.database === resource.database,
    );
  return (
    <ExportAccess.Provider value={investigating && allowExport}>
      <nav className="crumb" aria-label={w.workspace}>
        {fleetArchives.length > 1 && (
          <>
            <a href="/?view=regions">{w.regionalFleet}</a>
            <ChevronRight size={13} />
          </>
        )}
        <Database size={15} />
        {connections.length > 1 ? (
          <select
            aria-label={w.archive}
            value={connection.name}
            onChange={(e) => location.assign(archiveUrl(e.target.value))}
          >
            {connections.map((c) => (
              <option key={c.name} value={c.name}>
                {regions[c.name] ? regions[c.name] + " · " : ""}
                {c.name}
              </option>
            ))}
          </select>
        ) : (
          <span>
            {regions[connection.name] ? regions[connection.name] + " · " : ""}
            {connection.name}
          </span>
        )}
        <ChevronRight size={13} />
        <a href={archiveUrl(connection.name)}>{w.fleet}</a>
        {investigating && (
          <>
            <ChevronRight size={13} />
            {w.progress}
          </>
        )}
        {savedEnabled && (
          <SavedViews
            selected={
              investigating
                ? {
                    connection,
                    resource,
                    around,
                    bounds: selectedRange,
                    view: activeSection(params),
                    incident: params.get("incident"),
                  }
                : null
            }
          />
        )}
      </nav>
      {investigating ? (
        <Incident
          connection={connection}
          resource={resource}
          around={new Date(around).toISOString()}
          revisionId={params.get("incident")}
          bounds={selectedRange}
        />
      ) : grant.view_fleet ? (
        <Fleet
          connection={connection}
          canInspect={(r) => mayInspect(grant, r)}
        />
      ) : (
        <>
          <header className="page-head">
            <h1>{w.assigned}</h1>
          </header>
          <section className="panel resource-list">
            {grant.resources.map((row) => (
              <div key={row.selector.namespace_id + row.selector.database}>
                {row.inspect_evidence ? (
                  <a
                    href={investigationUrl(
                      connection,
                      row.selector,
                      new Date().toISOString(),
                    )}
                  >
                    {row.label}
                    <ChevronRight size={15} />
                  </a>
                ) : (
                  <strong>{row.label}</strong>
                )}
              </div>
            ))}
          </section>
        </>
      )}
    </ExportAccess.Provider>
  );
}
