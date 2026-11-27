import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertOctagon,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Database,
  Flame,
  FolderGit2,
  Layers3,
  Radio,
  RefreshCw,
  Search,
  ServerCrash,
  X,
} from "lucide-react";
import type { WarehouseFleetCursor } from "../../vendor/culprit/app/src/gen/WarehouseFleetCursor";
import type { WarehouseFleetRow } from "../../vendor/culprit/app/src/gen/WarehouseFleetRow";
import type { Engine } from "../../vendor/culprit/app/src/gen/Engine";
import { api, isDemoMode, useRead, type WarehouseConnectionRef } from "./api";
import { EngineBadge } from "./EngineBadge";
import { fleetRequest } from "./fleetRequest";
import { FleetCharts } from "./FleetCharts";
import { useLiveTick } from "./livePulse";
import { investigationUrl, spaClick } from "./navigation";
import { SelectMenu } from "./SelectMenu";
import type { PublishedResourceSelector } from "./api";
import {
  MicroMeter,
  Sparkline,
  StateMessage,
  humanizeGap,
  relativeAge,
  stamp,
  waitTone,
} from "./shared";
import w from "./en.json";

type SortMode = "attention" | "resource" | "utilization" | "incidents";

export function Fleet({
  connection,
  canInspect,
  onRowsLoaded,
}: {
  connection: WarehouseConnectionRef;
  canInspect: (resource: PublishedResourceSelector) => boolean;
  onRowsLoaded?: (rows: WarehouseFleetRow[]) => void;
}) {
  const liveTick = useLiveTick();
  const [asOf, setAsOf] = useState(() =>
    isDemoMode() ? "2026-10-11T12:14:00.000Z" : new Date().toISOString(),
  );
  const [attention, setAttention] = useState(false);
  const [search, setSearch] = useState("");
  const [envFilter, setEnvFilter] = useState<string | null>(null);
  const [engineFilter, setEngineFilter] = useState<Engine | null>(null);
  const [groupByPool, setGroupByPool] = useState(false);
  const [sort, setSort] = useState<SortMode>("attention");
  const [cursors, setCursors] = useState<(WarehouseFleetCursor | null)[]>([
    null,
  ]);
  const searchRef = useRef<HTMLInputElement>(null);
  const after = cursors[cursors.length - 1];
  const backendSort = sort === "resource" ? "resource" : "attention";

  useEffect(() => {
    setCursors([null]);
    setEnvFilter(null);
    setEngineFilter(null);
    setSearch("");
  }, [connection.name]);

  useEffect(() => {
    const onSlash = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        !e.metaKey &&
        !e.ctrlKey &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onSlash);
    return () => window.removeEventListener("keydown", onSlash);
  }, []);

  const load = useCallback(
    (signal: AbortSignal) => {
      const effectiveCutoff =
        liveTick > 0 && !isDemoMode() ? new Date().toISOString() : asOf;
      void liveTick;
      return api.fleet(
        connection,
        fleetRequest(effectiveCutoff, 24, attention, after, {
          sort: backendSort,
        }),
        signal,
      );
    },
    [connection, asOf, attention, after, backendSort, liveTick],
  );

  // Stale-while-revalidate keyed by connection.name prevents DOM collapse & scroll jump!
  const data = useRead(load, `fleet:${connection.name}`);
  const report = data.status === "ready" ? data.value : null;

  useEffect(() => {
    if (report?.rows && onRowsLoaded) onRowsLoaded(report.rows);
  }, [report, onRowsLoaded]);

  const environments = useMemo(() => {
    if (!report) return [];
    return [
      ...new Set(
        report.rows
          .map((r) => r.environment)
          .filter((env): env is string => Boolean(env)),
      ),
    ];
  }, [report]);

  const engineOptions = useMemo(() => {
    if (!report) return [];
    return [...new Set(report.rows.map((r) => r.engine))];
  }, [report]);

  const hasSharedPools = useMemo(
    () => Boolean(report?.rows.some((r) => r.shared_group)),
    [report],
  );

  const visibleRows = useMemo(() => {
    if (!report) return [];
    const q = search.trim().toLowerCase();
    const filtered = report.rows.filter((row) => {
      if (envFilter && row.environment !== envFilter) return false;
      if (engineFilter && row.engine !== engineFilter) return false;
      if (!q) return true;
      return (
        row.database_name.toLowerCase().includes(q) ||
        (row.connection_alias?.toLowerCase().includes(q) ?? false) ||
        (row.environment?.toLowerCase().includes(q) ?? false) ||
        (row.shared_group?.label.toLowerCase().includes(q) ?? false) ||
        row.engine.toLowerCase().includes(q)
      );
    });
    if (sort === "utilization") {
      filtered.sort(
        (a, b) =>
          Math.max(b.telemetry?.cpu_pct ?? 0, b.telemetry?.memory_pct ?? 0) -
          Math.max(a.telemetry?.cpu_pct ?? 0, a.telemetry?.memory_pct ?? 0),
      );
    } else if (sort === "incidents") {
      filtered.sort(
        (a, b) =>
          b.active_incidents - a.active_incidents ||
          b.high_findings - a.high_findings,
      );
    }
    return filtered;
  }, [report, search, envFilter, engineFilter, sort]);

  const hasTelemetry = useMemo(
    () => visibleRows.some((r) => r.telemetry != null),
    [visibleRows],
  );

  const groupedRows = useMemo(() => {
    if (!groupByPool)
      return [{ key: "", label: null as string | null, rows: visibleRows }];
    const map = new Map<string, { label: string; rows: WarehouseFleetRow[] }>();
    const standalone: WarehouseFleetRow[] = [];
    for (const row of visibleRows) {
      if (row.shared_group) {
        const key = row.shared_group.member_id;
        const entry = map.get(key) ?? {
          label: `${row.shared_group.label} (${row.shared_group.member_kind})`,
          rows: [],
        };
        entry.rows.push(row);
        map.set(key, entry);
      } else {
        standalone.push(row);
      }
    }
    const groups: {
      key: string;
      label: string | null;
      rows: WarehouseFleetRow[];
    }[] = [...map.entries()].map(([key, val]) => ({
      key,
      label: val.label,
      rows: val.rows,
    }));
    if (standalone.length) {
      groups.push({
        key: "__standalone__",
        label: groups.length ? "Dedicated instances" : null,
        rows: standalone,
      });
    }
    return groups;
  }, [groupByPool, visibleRows]);

  const summary = report?.summary;
  const metrics = [
    {
      label: w.resources,
      value: summary?.evaluated_resources,
      icon: Database,
      tone: "neutral",
    },
    {
      label: w.incidents,
      value: summary?.active_incidents,
      icon: Radio,
      tone: (summary?.active_incidents ?? 0) > 0 ? "danger" : "neutral",
    },
    {
      label: w.attention,
      value: summary?.attention_resources,
      icon: CircleAlert,
      tone: (summary?.attention_resources ?? 0) > 0 ? "warn" : "neutral",
    },
    {
      label: w.findings,
      value: summary?.high_finding_resources,
      icon: Flame,
      tone: (summary?.high_finding_resources ?? 0) > 0 ? "warn" : "neutral",
    },
    {
      label: w.coverage,
      value: summary?.stale_or_partial_resources,
      icon: Layers3,
      tone:
        (summary?.stale_or_partial_resources ?? 0) > 0 ? "warn" : "neutral",
    },
  ];

  const collectorTargets = report?.collector_targets ?? [];
  const effectiveAsOf =
    report?.rows[0]?.latest_collected_until && isDemoMode()
      ? "2026-10-11T12:14:00.000Z"
      : asOf;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{w.overview}</h1>
          <p>{w.subheading}</p>
        </div>
        <div className="head-actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              setCursors([null]);
              setAsOf(
                isDemoMode()
                  ? "2026-10-11T12:14:00.000Z"
                  : new Date().toISOString(),
              );
            }}
          >
            <RefreshCw
              size={15}
              className={data.refreshing ? "spin" : undefined}
            />
            {w.refresh}
          </button>
        </div>
      </header>

      <section className="metrics metrics-5" aria-label={w.summary}>
        {metrics.map((m) => (
          <div className={`metric metric-${m.tone}`} key={m.label}>
            <span>
              <m.icon size={15} />
              {m.label}
            </span>
            <strong>{m.value ?? "—"}</strong>
          </div>
        ))}
      </section>

      {report && <FleetCharts rows={report.rows} />}

      <section
        className={`panel fleet-panel ${data.refreshing ? "is-refreshing" : ""}`}
      >
        <div className="panel-head fleet-panel-head">
          <div className="panel-head-copy">
            <h2>{w.table}</h2>
            <small>
              {w.asof} {stamp(effectiveAsOf)}
            </small>
          </div>
          <div className="fleet-controls">
            <div className="search-box">
              <Search size={14} />
              <input
                ref={searchRef}
                value={search}
                placeholder={w.searchFleet}
                aria-label={w.searchFleet}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search ? (
                <button
                  type="button"
                  className="clear-search"
                  aria-label="Clear filter"
                  onClick={() => setSearch("")}
                >
                  <X size={13} />
                </button>
              ) : (
                <kbd aria-hidden="true">/</kbd>
              )}
            </div>
            <div className="switcher">
              {[false, true].map((value) => (
                <button
                  type="button"
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
        </div>

        {report &&
          (environments.length > 1 ||
            engineOptions.length > 1 ||
            hasSharedPools) && (
            <div className="filter-bar">
              {environments.length > 1 && (
                <div
                  className="filter-chips"
                  role="group"
                  aria-label="Environment"
                >
                  <button
                    type="button"
                    className="chip"
                    data-active={envFilter === null}
                    onClick={() => setEnvFilter(null)}
                  >
                    All envs
                  </button>
                  {environments.map((env) => (
                    <button
                      type="button"
                      key={env}
                      className="chip"
                      data-active={envFilter === env}
                      onClick={() =>
                        setEnvFilter(envFilter === env ? null : env)
                      }
                    >
                      <i className={`env-dot env-${env.toLowerCase()}`} />
                      {env}
                    </button>
                  ))}
                </div>
              )}
              {engineOptions.length > 1 && (
                <div className="filter-chips" role="group" aria-label="Engine">
                  <button
                    type="button"
                    className="chip"
                    data-active={engineFilter === null}
                    onClick={() => setEngineFilter(null)}
                  >
                    All engines
                  </button>
                  {engineOptions.map((eng) => (
                    <button
                      type="button"
                      key={eng}
                      className="chip"
                      data-active={engineFilter === eng}
                      onClick={() =>
                        setEngineFilter(engineFilter === eng ? null : eng)
                      }
                    >
                      <EngineBadge engine={eng} compact />
                      <span>{eng.toUpperCase()}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="filter-bar-end">
                {hasSharedPools && (
                  <button
                    type="button"
                    className="chip"
                    data-active={groupByPool}
                    onClick={() => setGroupByPool((v) => !v)}
                  >
                    <FolderGit2 size={13} />
                    Group by pool / cluster
                  </button>
                )}
                <SelectMenu<SortMode>
                  label="Sort resources"
                  prefix="Sort"
                  value={sort}
                  onChange={(next) => {
                    setSort(next);
                    setCursors([null]);
                  }}
                  options={[
                    {
                      value: "attention",
                      label: "Attention priority",
                      detail: "Incidents, high findings & stale targets first",
                    },
                    {
                      value: "utilization",
                      label: "CPU / Memory pressure",
                      detail: "Highest resource saturation first",
                    },
                    {
                      value: "incidents",
                      label: "Active incidents",
                      detail: "Most active incidents & findings first",
                    },
                    {
                      value: "resource",
                      label: "Database name",
                      detail: "Alphabetical A → Z",
                    },
                  ]}
                />
              </div>
            </div>
          )}

        {report ? (
          <>
            <div className="table-scroll">
              <table className="fleet-table">
                <thead>
                  <tr>
                    <th>{w.database}</th>
                    <th>{w.engine}</th>
                    <th>{w.freshness}</th>
                    {hasTelemetry && <th>{w.utilization}</th>}
                    {hasTelemetry && <th>{w.trend}</th>}
                    <th>{w.incidents}</th>
                    <th>{w.findings}</th>
                    <th>{w.observed}</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedRows.map((group) => (
                    <GroupRows
                      key={group.key || "all"}
                      label={group.label}
                      rows={group.rows}
                      colSpan={hasTelemetry ? 8 : 6}
                      hasTelemetry={hasTelemetry}
                      connection={connection}
                      canInspect={canInspect}
                      asOf={effectiveAsOf}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {!visibleRows.length && <div className="notice">{w.noRows}</div>}
            <footer className="table-foot">
              <span>
                {w.pages} {cursors.length} · {visibleRows.length}{" "}
                {w.shown.toLowerCase()}
              </span>
              <div>
                <button
                  type="button"
                  className="button"
                  disabled={cursors.length === 1}
                  onClick={() => setCursors((v) => v.slice(0, -1))}
                >
                  <ChevronLeft size={14} />
                  {w.prev}
                </button>
                <button
                  type="button"
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

      {collectorTargets.length > 0 && (
        <section className="panel collector-targets-panel">
          <div className="panel-head">
            <div className="panel-head-copy">
              <h2 className="icon-heading">
                <ServerCrash size={18} />
                {w.collectorTargets}
              </h2>
              <small>
                Configured targets in CulpritCollectorConnectionsV1 whose latest
                collection attempt failed or stopped before publishing
              </small>
            </div>
            <span className="count-pill pill-danger">
              {collectorTargets.length} unreachable
            </span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Target</th>
                  <th>Engine</th>
                  <th>Outcome</th>
                  <th>Detail</th>
                  <th>Attempted</th>
                </tr>
              </thead>
              <tbody>
                {collectorTargets.map((target) => (
                  <tr key={target.connection_id}>
                    <td>
                      <strong>{target.connection_name}</strong>
                      <small>{target.connection_id.slice(0, 12)}</small>
                    </td>
                    <td>
                      <EngineBadge engine={target.engine} />
                    </td>
                    <td>
                      <span className="status danger">
                        <i />
                        {target.connection_outcome}
                      </span>
                    </td>
                    <td>
                      {target.original_stop ??
                        target.original_status ??
                        "Connection failed"}
                    </td>
                    <td className="timestamp">{stamp(target.finished_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {report &&
        (!report.discovery_complete ||
          report.gaps.length > 0 ||
          report.qualifications.length > 0) && (
          <aside className="notice notes">
            <AlertOctagon size={16} />
            <strong>{w.reason}</strong>
            {!report.discovery_complete && <span>{w.partial}</span>}
            {[
              ...report.gaps.map((g) => humanizeGap(g.kind)),
              ...report.qualifications,
            ].map((v, i) => (
              <span key={i}>{v}</span>
            ))}
          </aside>
        )}
    </>
  );
}

function GroupRows({
  label,
  rows,
  colSpan,
  hasTelemetry,
  connection,
  canInspect,
  asOf,
}: {
  label: string | null;
  rows: WarehouseFleetRow[];
  colSpan: number;
  hasTelemetry: boolean;
  connection: WarehouseConnectionRef;
  canInspect: (resource: PublishedResourceSelector) => boolean;
  asOf: string;
}) {
  return (
    <>
      {label && (
        <tr className="group-header-row">
          <td colSpan={colSpan}>
            <FolderGit2 size={13} />
            <strong>{label}</strong>
            <small>{rows.length} databases</small>
          </td>
        </tr>
      )}
      {rows.map((row) => {
        const href = investigationUrl(
          connection,
          row.selector,
          row.latest_observed_until ?? row.latest_collected_until,
        );
        const envLabel = row.environment ?? row.connection_alias;
        const telemetry = row.telemetry;
        const peakUtil = Math.max(
          telemetry?.cpu_pct ?? 0,
          telemetry?.memory_pct ?? 0,
        );
        return (
          <tr
            key={row.resource_id}
            className={row.active_incidents > 0 ? "row-attention" : undefined}
          >
            <td>
              <div className="db-cell">
                {canInspect(row.selector) ? (
                  <a className="db-link" href={href} onClick={spaClick}>
                    {row.database_name}
                    <ArrowRight size={14} />
                  </a>
                ) : (
                  <strong>{row.database_name}</strong>
                )}
                <div className="db-meta">
                  {envLabel && (
                    <span className="env-label">
                      <i
                        className={`env-dot env-${envLabel.toLowerCase()}`}
                        aria-hidden="true"
                      />
                      {envLabel}
                    </span>
                  )}
                  {row.shared_group && (
                    <span
                      className="pool-pill"
                      title={row.shared_group.member_kind}
                    >
                      {row.shared_group.label}
                    </span>
                  )}
                </div>
              </div>
            </td>
            <td>
              <EngineBadge engine={row.engine} />
            </td>
            <td>
              <span className={"status " + row.freshness}>
                <i />
                {w.states[row.freshness]}
              </span>
            </td>
            {hasTelemetry && (
              <td>
                <div className="util-pair">
                  <MicroMeter label="CPU" value={telemetry?.cpu_pct} />
                  <MicroMeter label="MEM" value={telemetry?.memory_pct} />
                </div>
              </td>
            )}
            {hasTelemetry && (
              <td>
                <div className="trend-cell">
                  <Sparkline
                    values={telemetry?.load_sparkline ?? []}
                    tone={
                      row.active_incidents > 0 || peakUtil >= 85
                        ? "danger"
                        : peakUtil >= 65
                          ? "warn"
                          : "accent"
                    }
                  />
                  {telemetry?.dominant_wait && (
                    <span
                      className={`wait-pill wait-${waitTone(telemetry.dominant_wait)}`}
                    >
                      {telemetry.dominant_wait}
                    </span>
                  )}
                </div>
              </td>
            )}
            <td>
              {row.active_incidents > 0 ? (
                <span className="count-pill pill-danger">
                  {row.active_incidents}
                </span>
              ) : (
                <span className="zero-count">0</span>
              )}
              {row.uncertain_incidents > 0 && (
                <small>{row.uncertain_incidents} uncertain</small>
              )}
            </td>
            <td>
              {row.high_findings > 0 ? (
                <span className="count-pill pill-warn">
                  {row.high_findings}
                </span>
              ) : (
                <span className="zero-count">0</span>
              )}
              {row.recent_regressions > 0 && (
                <small>{row.recent_regressions} regr.</small>
              )}
            </td>
            <td className="timestamp">
              <span>{stamp(row.latest_collected_until)}</span>
              <small>{relativeAge(row.latest_collected_until, asOf)}</small>
            </td>
          </tr>
        );
      })}
    </>
  );
}
