import { useCallback, useEffect, useMemo, useState } from "react";
import { RegionalFleet } from "./RegionalFleet";
import { ChevronRight, Globe2 } from "lucide-react";
import type { WarehouseFleetRow } from "../../vendor/culprit/app/src/gen/WarehouseFleetRow";
import {
  api,
  ExportAccess,
  isDemoMode,
  useRead,
  type Session,
  type ArchiveAccess,
  type PublishedResourceSelector,
} from "./api";
import {
  CommandPalette,
  type PaletteDemoScenario,
  type PaletteResource,
} from "./CommandPalette";
import { ArchiveScaleSwitcher } from "./SelectMenu";
import { SavedViews } from "./SavedViews";
import { Fleet } from "./Fleet";
import { Incident, type KnownDatabaseMeta } from "./Incident";
import { StateMessage } from "./shared";
import {
  archiveUrl,
  investigationUrl,
  getRange,
  parseRoute,
  regionsUrl,
  spaClick,
  useLocationHref,
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
  useLocationHref();
  const [knownResources, setKnownResources] = useState<PaletteResource[]>([]);
  const [demoScenarios, setDemoScenarios] = useState<PaletteDemoScenario[]>([]);

  useEffect(() => {
    if (!isDemoMode()) return;
    import("./demoMode").then((mod) => {
      setDemoScenarios(mod.getDemoScenarios());
      setKnownResources(mod.getDemoPaletteResources());
    });
  }, []);

  const result = useRead(api.connections, "connections");
  const connections = result.status === "ready" ? result.value : [];

  const route = parseRoute();
  const params = route.params;
  const name =
    route.kind === "archive" || route.kind === "investigate"
      ? route.archive
      : null;
  const revision = params.get("revision");
  const fleetArchives = connections.filter(
    (item) => access.archives[item.name]?.view_fleet,
  );
  const overview =
    route.kind === "regions" ||
    (route.kind === "home" && fleetArchives.length > 1);

  const candidates = connections.filter((item) =>
    name ? item.name === name : item.revision === revision,
  );
  const connection =
    name || revision
      ? candidates.length === 1
        ? candidates[0]
        : undefined
      : connections[0];

  const handleRowsLoaded = useCallback(
    (rows: WarehouseFleetRow[]) => {
      if (!connection) return;
      const grant = access.archives[connection.name];
      if (!grant) return;
      const mapped: PaletteResource[] = rows
        .filter((r) => mayInspect(grant, r.selector))
        .map((r) => ({
          name: r.database_name,
          engine: r.engine,
          environment: r.environment,
          archive: connection,
          selector: r.selector,
          around: r.latest_observed_until ?? r.latest_collected_until,
          freshness: r.freshness,
          sharedGroup: r.shared_group,
          activeIncidents: r.active_incidents,
          cpuPct: r.telemetry?.cpu_pct ?? null,
          memoryPct: r.telemetry?.memory_pct ?? null,
          dominantWait: r.telemetry?.dominant_wait ?? null,
          latestCollectedUntil: r.latest_collected_until,
        }));
      setKnownResources((prev) => {
        const filtered = prev.filter(
          (item) => item.archive.name !== connection.name,
        );
        return [...filtered, ...mapped];
      });
    },
    [connection, access.archives],
  );

  const nsParam = params.get("namespace") ?? "";
  const dbParam = params.get("database") ?? "";
  const resource = useMemo(
    () => ({
      namespace_id: nsParam,
      database: dbParam,
    }),
    [nsParam, dbParam],
  );

  const knownMeta = useMemo<KnownDatabaseMeta | null>(() => {
    if (!connection) return null;
    const hit = knownResources.find(
      (r) =>
        r.archive.name === connection.name &&
        r.selector.namespace_id === resource.namespace_id &&
        r.selector.database === resource.database,
    );
    if (hit) {
      const poolSiblings = hit.sharedGroup
        ? knownResources
            .filter(
              (r) =>
                r.archive.name === connection.name &&
                r.sharedGroup?.member_id === hit.sharedGroup?.member_id &&
                (r.selector.namespace_id !== resource.namespace_id ||
                  r.selector.database !== resource.database),
            )
            .map((s) => ({
              name: s.name,
              selector: s.selector,
              around: s.around,
              activeIncidents: s.activeIncidents ?? 0,
              cpuPct: s.cpuPct ?? null,
              dominantWait: s.dominantWait ?? null,
            }))
        : [];
      return {
        name: hit.name,
        engine: hit.engine,
        environment: hit.environment,
        freshness: hit.freshness,
        sharedGroup: hit.sharedGroup,
        activeIncidents: hit.activeIncidents,
        cpuPct: hit.cpuPct,
        memoryPct: hit.memoryPct,
        dominantWait: hit.dominantWait,
        latestCollectedUntil: hit.latestCollectedUntil,
        poolSiblings,
      };
    }
    const grantRes = access.archives[connection.name]?.resources.find(
      (r) =>
        r.selector.namespace_id === resource.namespace_id &&
        r.selector.database === resource.database,
    );
    if (grantRes) {
      return { name: grantRes.label, engine: null, environment: null };
    }
    return null;
  }, [connection, knownResources, resource, access.archives]);

  if (result.status !== "ready")
    return (
      <StateMessage
        error={result.status === "error" ? result.message : undefined}
      />
    );

  const investigating = route.kind === "investigate";

  if (overview) {
    return (
      <>
        <CommandPalette
          connections={fleetArchives}
          regions={regions}
          knownResources={knownResources}
          investigating={false}
          demoScenarios={demoScenarios}
        />
        <RegionalFleet connections={fleetArchives} regions={regions} />
      </>
    );
  }

  if (!connection || !Object.hasOwn(access.archives, connection.name))
    return <StateMessage error={w.badLink} />;
  const grant = access.archives[connection.name];
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
      <CommandPalette
        connections={fleetArchives}
        regions={regions}
        knownResources={knownResources}
        investigating={investigating}
        demoScenarios={demoScenarios}
      />
      <nav className="crumb" aria-label={w.workspace}>
        {fleetArchives.length > 1 && (
          <>
            <a className="crumb-link" href={regionsUrl()} onClick={spaClick}>
              <Globe2 size={13} />
              <span>{w.regionalFleet}</span>
            </a>
            <ChevronRight size={13} className="crumb-sep" />
          </>
        )}
        <ArchiveScaleSwitcher
          current={connection}
          connections={connections}
          regions={regions}
          showRegionsLink={fleetArchives.length > 1}
        />
        <ChevronRight size={13} className="crumb-sep" />
        {investigating ? (
          <>
            <a
              className="crumb-link"
              href={archiveUrl(connection.name)}
              onClick={spaClick}
            >
              {w.fleet}
            </a>
            <ChevronRight size={13} className="crumb-sep" />
            <span className="crumb-current">
              {knownMeta?.name ?? w.progress}
            </span>
          </>
        ) : (
          <span className="crumb-current">{w.fleet}</span>
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
                    view: route.section,
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
          knownMeta={knownMeta}
        />
      ) : grant.view_fleet ? (
        <Fleet
          connection={connection}
          canInspect={(r) => mayInspect(grant, r)}
          onRowsLoaded={handleRowsLoaded}
        />
      ) : (
        <>
          <header className="page-head">
            <div>
              <h1>{w.assigned}</h1>
            </div>
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
                    onClick={spaClick}
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
