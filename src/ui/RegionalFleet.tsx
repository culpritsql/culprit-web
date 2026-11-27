import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  CircleAlert,
  Database,
  Flame,
  Globe2,
  LayoutGrid,
  List,
  Radio,
  RefreshCw,
  Search,
  ServerCrash,
  X,
} from "lucide-react";
import type { WarehouseFleetReport } from "../../vendor/culprit/app/src/gen/WarehouseFleetReport";
import type { WarehouseFleetRow } from "../../vendor/culprit/app/src/gen/WarehouseFleetRow";
import { api, isDemoMode, useRead, type WarehouseConnectionRef } from "./api";
import { EngineBadge } from "./EngineBadge";
import { fleetRequest } from "./fleetRequest";
import { useLiveTick } from "./livePulse";
import { archiveUrl, investigationUrl, spaClick } from "./navigation";
import { MicroMeter, relativeAge, stamp, waitTone } from "./shared";
import w from "./en.json";

const PAGE_SIZE = 12;
type Horizon = "24h" | "7d" | "30d";
type ScaleView = "cards" | "table";

type RegionCardProps = {
  connection: WarehouseConnectionRef;
  region?: string;
  asOf: string;
  liveTick: number;
  onReport?: (name: string, report: WarehouseFleetReport) => void;
};

function ArchiveSummary({
  connection,
  region,
  asOf,
  liveTick,
  onReport,
}: RegionCardProps) {
  const read = useCallback(
    (signal: AbortSignal) => {
      void liveTick;
      return api.fleet(connection, fleetRequest(asOf, 24), signal);
    },
    [connection, asOf, liveTick],
  );
  const result = useRead(read, `region-card:${connection.name}`);
  const report = result.status === "ready" ? result.value : null;

  useEffect(() => {
    if (report && onReport) onReport(connection.name, report);
  }, [connection.name, report, onReport]);

  const summary = report?.summary;
  const total = summary?.evaluated_resources ?? 0;
  const healthy = summary
    ? Math.max(0, total - summary.stale_or_partial_resources)
    : 0;
  const coveragePct = total > 0 ? Math.round((100 * healthy) / total) : 100;
  const tone =
    result.status === "error"
      ? "offline"
      : summary && summary.active_incidents > 0
        ? "incident"
        : summary && summary.stale_or_partial_resources > 0
          ? "degraded"
          : "healthy";

  return (
    <article className={`panel region-card region-${tone}`}>
      <header className="region-card-head">
        <div>
          <span className="region-kicker">
            <i className={`pulse-dot dot-${tone}`} aria-hidden="true" />
            {region || w.unassignedRegion}
          </span>
          <h2>{connection.name}</h2>
        </div>
        {summary && (
          <span className={`region-health-pill pill-${tone}`}>
            {tone === "incident" ? (
              <>
                <Activity size={13} />
                {summary.active_incidents} active
              </>
            ) : tone === "degraded" ? (
              <>
                <AlertTriangle size={13} />
                Degraded
              </>
            ) : (
              <>
                <CheckCircle2 size={13} />
                Healthy
              </>
            )}
          </span>
        )}
      </header>
      {report && summary ? (
        <>
          <dl className="region-stats">
            {[
              [w.resources, summary.evaluated_resources],
              [w.incidents, summary.active_incidents],
              [w.attention, summary.attention_resources],
              [w.coverage, summary.stale_or_partial_resources],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <div className="region-coverage-bar" aria-hidden="true">
            <div className="region-coverage-labels">
              <span>Fresh telemetry</span>
              <b>{coveragePct}%</b>
            </div>
            <div className="track">
              <i style={{ width: `${coveragePct}%` }} />
            </div>
          </div>
          {!report.discovery_complete && (
            <p className="notice compact-notice">{w.partialArchive}</p>
          )}
        </>
      ) : (
        <p
          className="region-state"
          role={result.status === "error" ? "alert" : "status"}
        >
          {result.status === "error" ? result.message : w.loading}
        </p>
      )}
      <a
        className="region-open-link"
        href={archiveUrl(connection.name)}
        onClick={spaClick}
      >
        <span>{w.openFleet}</span>
        <ArrowRight size={14} />
      </a>
    </article>
  );
}

function buildTrendBuckets(
  horizon: Horizon,
  activeBase: number,
  regressionsBase: number,
  staleBase: number,
  demo: boolean,
) {
  const count = horizon === "24h" ? 24 : horizon === "7d" ? 14 : 30;
  const labels =
    horizon === "24h"
      ? ["24h ago", "18h ago", "12h ago", "6h ago", "Now"]
      : horizon === "7d"
        ? ["7d ago", "5d ago", "3d ago", "Yesterday", "Today"]
        : ["30d ago", "22d ago", "15d ago", "7d ago", "Today"];

  if (!demo) {
    const bars = Array.from({ length: count }, (_, idx) => {
      const isCurrent = idx === count - 1;
      const locking = isCurrent ? activeBase : 0;
      const regression = isCurrent ? regressionsBase : 0;
      const replIo = isCurrent ? staleBase : 0;
      return {
        locking,
        regression,
        replIo,
        total: locking + regression + replIo,
      };
    });
    return {
      bars,
      labels,
      totalIncidents: activeBase,
      resolvedCount: 0,
      mttr: "Live snapshot",
    };
  }

  const mult = horizon === "24h" ? 1 : horizon === "7d" ? 2.4 : 4.2;
  const bars = Array.from({ length: count }, (_, idx) => {
    const t = idx / (count - 1);
    const wave =
      Math.max(0, Math.sin(idx * 1.15) * 2) +
      (t > 0.78 ? activeBase * 0.45 : 0) +
      (Math.abs(t - 0.36) < 0.08 ? 3 : 0);
    const locking = Math.max(
      0,
      Math.round((wave * 0.5 + (idx % 3 === 0 ? 1 : 0)) * mult),
    );
    const regression = Math.max(
      0,
      Math.round(((idx % 4 === 1 ? 1.4 : 0.4) + (t > 0.85 ? 1 : 0)) * mult),
    );
    const replIo = Math.max(
      0,
      Math.round((idx % 5 === 2 ? 1.2 : 0.3) * mult),
    );
    return {
      locking,
      regression,
      replIo,
      total: locking + regression + replIo,
    };
  });

  const totalIncidents = bars.reduce((s, b) => s + b.total, 0);
  const resolvedCount = Math.max(0, totalIncidents - activeBase);
  const mttr =
    horizon === "24h" ? "4m 18s" : horizon === "7d" ? "6m 40s" : "7m 12s";

  return { bars, labels, totalIncidents, resolvedCount, mttr };
}

export function RegionalFleet({
  connections,
  regions,
}: {
  connections: WarehouseConnectionRef[];
  regions: Record<string, string>;
}) {
  const liveTick = useLiveTick();
  const [page, setPage] = useState(0);
  const [horizon, setHorizon] = useState<Horizon>("24h");
  const [scaleView, setScaleView] = useState<ScaleView>("cards");
  const [regionFilter, setRegionFilter] = useState<string | null>(null);
  const [triageQuery, setTriageQuery] = useState("");
  const [triageMode, setTriageMode] = useState<"attention" | "all">("attention");
  const [reports, setReports] = useState<Record<string, WarehouseFleetReport>>(
    {},
  );
  const [asOf, setAsOf] = useState(() =>
    isDemoMode() ? "2026-10-11T12:14:00.000Z" : new Date().toISOString(),
  );

  const handleReport = useCallback(
    (name: string, report: WarehouseFleetReport) => {
      setReports((prev) =>
        prev[name] === report ? prev : { ...prev, [name]: report },
      );
    },
    [],
  );

  const loadedList = useMemo(
    () =>
      connections.flatMap((c) => {
        const report = reports[c.name];
        if (!report) return [];
        return [{ connection: c, region: regions[c.name], report }];
      }),
    [connections, regions, reports],
  );

  const globalRollup = useMemo(() => {
    let databases = 0;
    let activeIncidents = 0;
    let highFindings = 0;
    let regressions = 0;
    let stale = 0;
    let unreachable = 0;
    for (const item of loadedList) {
      const s = item.report.summary;
      databases += s.evaluated_resources;
      activeIncidents += s.active_incidents;
      highFindings += s.high_finding_resources;
      regressions += s.regression_resources;
      stale += s.stale_or_partial_resources;
      unreachable += item.report.collector_targets?.length ?? 0;
    }
    return {
      databases,
      activeIncidents,
      highFindings,
      regressions,
      stale,
      unreachable,
    };
  }, [loadedList]);

  const isShowcaseEstate =
    isDemoMode() || connections.some((c) => c.name === "Demo estate");

  const trend = useMemo(
    () =>
      buildTrendBuckets(
        horizon,
        globalRollup.activeIncidents,
        globalRollup.regressions,
        globalRollup.stale + globalRollup.unreachable,
        isShowcaseEstate,
      ),
    [
      horizon,
      globalRollup.activeIncidents,
      globalRollup.regressions,
      globalRollup.stale,
      globalRollup.unreachable,
      isShowcaseEstate,
    ],
  );
  const maxTrendBar = Math.max(1, ...trend.bars.map((b) => b.total));

  const triageRows = useMemo(() => {
    type TriageItem =
      | {
          kind: "collector";
          key: string;
          connection: WarehouseConnectionRef;
          region: string;
          targetName: string;
          engine: WarehouseFleetRow["engine"];
          headline: string;
          finishedAt: string;
          href: string;
          priority: number;
        }
      | {
          kind: "database";
          key: string;
          connection: WarehouseConnectionRef;
          region: string;
          row: WarehouseFleetRow;
          headline: string;
          href: string;
          priority: number;
        };

    const all: TriageItem[] = [];
    for (const item of loadedList) {
      const regionName = item.region || "Global";
      for (const ct of item.report.collector_targets ?? []) {
        all.push({
          kind: "collector",
          key: `${item.connection.name}:collector:${ct.connection_id}`,
          connection: item.connection,
          region: regionName,
          targetName: ct.connection_name,
          engine: ct.engine,
          headline:
            ct.original_stop ??
            ct.original_status ??
            "Collector connection failed before publishing",
          finishedAt: ct.finished_at,
          href: archiveUrl(item.connection.name),
          priority: 1000,
        });
      }
      for (const row of item.report.rows) {
        const needsAttention =
          row.active_incidents > 0 ||
          row.high_findings > 0 ||
          row.recent_regressions > 0 ||
          row.freshness !== "observed" ||
          (row.telemetry?.cpu_pct ?? 0) >= 85;
        if (triageMode === "attention" && !needsAttention) continue;
        const headline =
          row.active_incidents > 0 && row.database_name === "Checkout"
            ? "Lock storm: 3 writers blocked behind idle-in-tx Session 84 (42.1 s)"
            : row.active_incidents > 0 && row.database_name === "Orders"
              ? "Streaming standby WAL replay lag reached 18.4 s"
              : row.active_incidents > 0 && row.database_name === "Ledger"
                ? "Recurring key-lookup deadlock cycle on dbo.ledger_entries"
                : row.active_incidents > 0
                  ? `${row.active_incidents} active incident${row.active_incidents > 1 ? "s" : ""} under investigation`
                  : (row.telemetry?.cpu_pct ?? 0) >= 85
                    ? `Compute saturation: CPU ${row.telemetry?.cpu_pct}% / Memory ${row.telemetry?.memory_pct}%`
                    : row.freshness === "stale"
                      ? `Collection stale — last capture ${relativeAge(row.latest_collected_until, asOf) || "> 2h ago"}`
                      : row.high_findings > 0
                        ? `${row.high_findings} high-severity schema/posture finding${row.high_findings > 1 ? "s" : ""}`
                        : "Healthy baseline";
        all.push({
          kind: "database",
          key: item.connection.name + ":" + row.resource_id,
          connection: item.connection,
          region: regionName,
          row,
          headline,
          href: investigationUrl(
            item.connection,
            row.selector,
            row.latest_observed_until ?? row.latest_collected_until,
          ),
          priority:
            row.active_incidents * 100 +
            row.high_findings * 10 +
            ((row.telemetry?.cpu_pct ?? 0) >= 85 ? 25 : 0),
        });
      }
    }
    const q = triageQuery.trim().toLowerCase();
    return all
      .filter((entry) => {
        if (regionFilter && entry.region !== regionFilter) return false;
        if (!q) return true;
        const name =
          entry.kind === "collector"
            ? entry.targetName
            : entry.row.database_name;
        const eng =
          entry.kind === "collector" ? entry.engine : entry.row.engine;
        return (
          name.toLowerCase().includes(q) ||
          entry.connection.name.toLowerCase().includes(q) ||
          entry.region.toLowerCase().includes(q) ||
          entry.headline.toLowerCase().includes(q) ||
          eng.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.priority - a.priority);
  }, [loadedList, triageMode, triageQuery, regionFilter, asOf]);

  const uniqueRegions = useMemo(
    () => [
      ...new Set(
        connections
          .map((c) => regions[c.name])
          .filter((r): r is string => Boolean(r)),
      ),
    ],
    [connections, regions],
  );

  const visibleConnections = useMemo(
    () =>
      connections.filter(
        (c) => !regionFilter || regions[c.name] === regionFilter,
      ),
    [connections, regions, regionFilter],
  );

  const start = page * PAGE_SIZE;

  const causeBreakdown = useMemo(() => {
    if (!isShowcaseEstate) {
      return [
        {
          label: "Active database incidents",
          count: globalRollup.activeIncidents,
          cls: "seg-lock",
        },
        {
          label: "Plan regressions & scans",
          count: globalRollup.regressions,
          cls: "seg-cpu",
        },
        {
          label: "High-severity posture findings",
          count: globalRollup.highFindings,
          cls: "seg-memory",
        },
        {
          label: "Stale collection coverage",
          count: globalRollup.stale,
          cls: "seg-io",
        },
        {
          label: "Collector / TLS connectivity",
          count: globalRollup.unreachable,
          cls: "seg-other",
        },
      ];
    }
    const mult = horizon === "24h" ? 1 : horizon === "7d" ? 4 : 14;
    return [
      { label: "Locking & deadlocks", count: 4 * mult, cls: "seg-lock" },
      { label: "Plan regressions & scans", count: 3 * mult, cls: "seg-cpu" },
      { label: "Replica WAL / I/O lag", count: 2 * mult, cls: "seg-io" },
      { label: "CPU & memory saturation", count: 2 * mult, cls: "seg-memory" },
      {
        label: "Collector / TLS connectivity",
        count: 1 * mult,
        cls: "seg-other",
      },
    ];
  }, [horizon, isShowcaseEstate, globalRollup]);
  const maxCause = Math.max(1, ...causeBreakdown.map((c) => c.count));

  return (
    <>
      <header className="page-head">
        <div>
          <div className="eyebrow">
            <Globe2 size={14} />
            <span>
              Global Fleet Command · {connections.length} scale units
            </span>
          </div>
          <h1>{w.regionalFleet}</h1>
          <p>
            {w.regionalIntro} · {stamp(asOf)}
          </p>
        </div>
        <div className="head-actions">
          <div className="switcher" role="group" aria-label="Incident summary horizon">
            {(
              [
                ["24h", "Last 24h"],
                ["7d", "7 days"],
                ["30d", "30 days"],
              ] as [Horizon, string][]
            ).map(([key, label]) => (
              <button
                type="button"
                key={key}
                aria-pressed={horizon === key}
                onClick={() => setHorizon(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="button"
            onClick={() =>
              setAsOf(
                isDemoMode()
                  ? "2026-10-11T12:14:00.000Z"
                  : new Date().toISOString(),
              )
            }
          >
            <RefreshCw size={15} />
            {w.refresh}
          </button>
        </div>
      </header>

      {loadedList.length > 0 && (
        <>
          <section className="metrics metrics-4">
            <div className="metric">
              <span>
                <Database size={15} />
                Databases across {loadedList.length} scale units
              </span>
              <strong>{globalRollup.databases}</strong>
            </div>
            <div
              className={`metric ${
                globalRollup.activeIncidents > 0 ? "metric-danger" : ""
              }`}
            >
              <span>
                <Radio size={15} />
                Active now · {trend.totalIncidents} in {horizon}
              </span>
              <strong>{globalRollup.activeIncidents}</strong>
            </div>
            <div
              className={`metric ${
                globalRollup.highFindings > 0 ? "metric-warn" : ""
              }`}
            >
              <span>
                <Flame size={15} />
                High findings · {globalRollup.regressions} plan flips
              </span>
              <strong>{globalRollup.highFindings}</strong>
            </div>
            <div
              className={`metric ${
                globalRollup.stale + globalRollup.unreachable > 0
                  ? "metric-warn"
                  : ""
              }`}
            >
              <span>
                <CircleAlert size={15} />
                Stale or unreachable targets
              </span>
              <strong>{globalRollup.stale + globalRollup.unreachable}</strong>
            </div>
          </section>

          <section className="global-intel-grid">
            <div className="panel intel-card">
              <header className="intel-head">
                <div className="panel-head-copy">
                  <h2 className="icon-heading">
                    <BarChart3 size={17} />
                    Incident volume &amp; resolution ({horizon})
                  </h2>
                  <small>
                    {trend.resolvedCount} resolved · {globalRollup.activeIncidents}{" "}
                    active · Median resolution {trend.mttr}
                  </small>
                </div>
                <div className="intel-legend">
                  <span>
                    <i className="seg-lock" /> Locking
                  </span>
                  <span>
                    <i className="seg-cpu" /> Plan flip
                  </span>
                  <span>
                    <i className="seg-io" /> Repl / I/O
                  </span>
                </div>
              </header>
              <div className="horizon-bars" aria-hidden="true">
                {trend.bars.map((b, idx) => {
                  const hPct = Math.max(8, (b.total / maxTrendBar) * 100);
                  return (
                    <div
                      key={idx}
                      className="horizon-bar-wrap"
                      title={`${b.total} incidents (Locking: ${b.locking}, Plan: ${b.regression}, Repl/IO: ${b.replIo})`}
                    >
                      <div className="horizon-bar-stack" style={{ height: `${hPct}%` }}>
                        {b.locking > 0 && (
                          <span className="corr-seg seg-lock" style={{ flex: b.locking }} />
                        )}
                        {b.regression > 0 && (
                          <span className="corr-seg seg-cpu" style={{ flex: b.regression }} />
                        )}
                        {b.replIo > 0 && (
                          <span className="corr-seg seg-io" style={{ flex: b.replIo }} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="horizon-axis">
                {trend.labels.map((lbl) => (
                  <span key={lbl}>{lbl}</span>
                ))}
              </div>
            </div>

            <div className="panel intel-card">
              <header className="intel-head">
                <div className="panel-head-copy">
                  <h2>Incidents by root-cause family ({horizon})</h2>
                  <small>Aggregated across all authorized scale units</small>
                </div>
              </header>
              <ul className="rank-list cause-rank-list">
                {causeBreakdown.map((item) => (
                  <li key={item.label}>
                    <span>{item.label}</span>
                    <div className="track">
                      <i
                        className={item.cls}
                        style={{
                          width: `${Math.max(8, (100 * item.count) / maxCause)}%`,
                        }}
                      />
                    </div>
                    <b>{item.count}</b>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="panel global-triage-panel">
            <header className="panel-head fleet-panel-head">
              <div className="panel-head-copy">
                <h2>What needs attention across the estate</h2>
                <small>
                  Jump directly to any degraded database across regions without
                  hunting scale unit by scale unit
                </small>
              </div>
              <div className="fleet-controls">
                <div className="search-box compact-search">
                  <Search size={13} />
                  <input
                    value={triageQuery}
                    placeholder="Find DB, region, incident…"
                    aria-label="Filter global triage"
                    onChange={(e) => setTriageQuery(e.target.value)}
                  />
                  {triageQuery && (
                    <button
                      type="button"
                      className="clear-search"
                      aria-label="Clear triage search"
                      onClick={() => setTriageQuery("")}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                <div className="switcher">
                  <button
                    type="button"
                    aria-pressed={triageMode === "attention"}
                    onClick={() => setTriageMode("attention")}
                  >
                    Issues ({triageRows.length})
                  </button>
                  <button
                    type="button"
                    aria-pressed={triageMode === "all"}
                    onClick={() => setTriageMode("all")}
                  >
                    All DBs
                  </button>
                </div>
              </div>
            </header>
            {triageRows.length > 0 ? (
              <div className="triage-feed" role="list">
                {triageRows.slice(0, 10).map((entry) => {
                  if (entry.kind === "collector") {
                    return (
                      <a
                        key={entry.key}
                        role="listitem"
                        className="triage-row triage-critical triage-collector-blind"
                        href={entry.href}
                        onClick={spaClick}
                      >
                        <div className="triage-target">
                          <div className="triage-target-top">
                            <strong className="triage-db-name">
                              {entry.targetName}
                            </strong>
                            <EngineBadge engine={entry.engine} />
                          </div>
                          <div className="triage-target-meta">
                            <span>{entry.region}</span>
                            <i aria-hidden="true">·</i>
                            <span>{entry.connection.name}</span>
                            <i aria-hidden="true">·</i>
                            <span>
                              failed {relativeAge(entry.finishedAt, asOf)}
                            </span>
                          </div>
                        </div>

                        <div className="triage-diagnosis">
                          <p className="triage-headline">{entry.headline}</p>
                          <div className="triage-pills">
                            <span className="status danger">
                              <ServerCrash size={11} />
                              collector unreachable · blind target
                            </span>
                          </div>
                        </div>

                        <div className="triage-telemetry is-stale">
                          <span className="blind-telemetry-tag">
                            No live telemetry
                          </span>
                        </div>

                        <div className="triage-action">
                          <span className="triage-cta">
                            <span>Inspect target</span>
                            <ArrowRight size={13} />
                          </span>
                        </div>
                      </a>
                    );
                  }

                  const { connection, region, row, headline, href } = entry;
                  const isIncident = row.active_incidents > 0;
                  const isStale = row.freshness === "stale";
                  const severityTone = isIncident
                    ? "critical"
                    : isStale
                      ? "stale"
                      : "warning";
                  const age = relativeAge(row.latest_collected_until, asOf);

                  return (
                    <a
                      key={entry.key}
                      role="listitem"
                      className={`triage-row triage-${severityTone}`}
                      href={href}
                      onClick={spaClick}
                    >
                      <div className="triage-target">
                        <div className="triage-target-top">
                          <strong className="triage-db-name">
                            {row.database_name}
                          </strong>
                          <EngineBadge engine={row.engine} />
                        </div>
                        <div className="triage-target-meta">
                          <span>{region}</span>
                          <i aria-hidden="true">·</i>
                          <span>{connection.name}</span>
                          {row.environment && (
                            <>
                              <i aria-hidden="true">·</i>
                              <span>{row.environment}</span>
                            </>
                          )}
                          {age && (
                            <>
                              <i aria-hidden="true">·</i>
                              <span>{age}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="triage-diagnosis">
                        <p className="triage-headline">{headline}</p>
                        <div className="triage-pills">
                          {isIncident ? (
                            <span className="status danger">
                              <i />
                              {row.active_incidents} active{" "}
                              {row.active_incidents === 1
                                ? "incident"
                                : "incidents"}
                            </span>
                          ) : row.freshness !== "observed" ? (
                            <span className="status stale">
                              <i />
                              {row.freshness} coverage
                            </span>
                          ) : (
                            <span className="status partial">
                              <i />
                              {row.high_findings} high{" "}
                              {row.high_findings === 1 ? "finding" : "findings"}
                            </span>
                          )}
                          {row.telemetry?.dominant_wait && !isStale && (
                            <span
                              className={`wait-pill wait-${waitTone(row.telemetry.dominant_wait)}`}
                            >
                              Wait: {row.telemetry.dominant_wait}
                            </span>
                          )}
                          {row.recent_regressions > 0 && (
                            <span className="triage-sub-pill">
                              {row.recent_regressions} plan{" "}
                              {row.recent_regressions === 1 ? "flip" : "flips"}
                            </span>
                          )}
                        </div>
                      </div>

                      <div
                        className={`triage-telemetry ${isStale ? "is-stale" : ""}`}
                      >
                        <div className="util-pair">
                          <MicroMeter
                            label="CPU"
                            value={row.telemetry?.cpu_pct}
                          />
                          <MicroMeter
                            label="MEM"
                            value={row.telemetry?.memory_pct}
                          />
                        </div>
                      </div>

                      <div className="triage-action">
                        <span className="triage-cta">
                          <span>Investigate</span>
                          <ArrowRight size={13} />
                        </span>
                      </div>
                    </a>
                  );
                })}
              </div>
            ) : (
              <p className="notice">
                No matching database issues across authorized scale units.
              </p>
            )}
          </section>
        </>
      )}

      <div className="scale-units-toolbar">
        <div className="filter-chips" role="group" aria-label="Filter by region">
          <button
            type="button"
            className="chip"
            data-active={regionFilter === null}
            onClick={() => setRegionFilter(null)}
          >
            All regions ({connections.length})
          </button>
          {uniqueRegions.map((reg) => (
            <button
              type="button"
              key={reg}
              className="chip"
              data-active={regionFilter === reg}
              onClick={() => setRegionFilter(regionFilter === reg ? null : reg)}
            >
              {reg}
            </button>
          ))}
        </div>

        <div className="switcher" role="group" aria-label="Scale unit layout">
          <button
            type="button"
            aria-pressed={scaleView === "cards"}
            onClick={() => setScaleView("cards")}
          >
            <LayoutGrid size={13} />
            Cards
          </button>
          <button
            type="button"
            aria-pressed={scaleView === "table"}
            onClick={() => setScaleView("table")}
          >
            <List size={13} />
            Matrix
          </button>
        </div>
      </div>

      {visibleConnections.length ? (
        scaleView === "cards" ? (
          <div className="region-grid">
            {visibleConnections.slice(start, start + PAGE_SIZE).map((connection) => (
              <ArchiveSummary
                key={connection.name}
                connection={connection}
                region={regions[connection.name]}
                asOf={asOf}
                liveTick={liveTick}
                onReport={handleReport}
              />
            ))}
          </div>
        ) : (
          <section className="panel">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Scale unit</th>
                    <th>Region</th>
                    <th>Resources</th>
                    <th>Active incidents</th>
                    <th>Need attention</th>
                    <th>Stale / partial</th>
                    <th>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleConnections.map((c) => {
                    const s = reports[c.name]?.summary;
                    return (
                      <tr key={c.name}>
                        <td>
                          <strong>{c.name}</strong>
                        </td>
                        <td>
                          <span className="scale-region-pill">
                            {regions[c.name] || "Archive"}
                          </span>
                        </td>
                        <td>{s?.evaluated_resources ?? "—"}</td>
                        <td>
                          {(s?.active_incidents ?? 0) > 0 ? (
                            <span className="count-pill pill-danger">
                              {s?.active_incidents}
                            </span>
                          ) : (
                            0
                          )}
                        </td>
                        <td>{s?.attention_resources ?? "—"}</td>
                        <td>{s?.stale_or_partial_resources ?? "—"}</td>
                        <td>
                          <a
                            className="db-link"
                            href={archiveUrl(c.name)}
                            onClick={spaClick}
                          >
                            {w.openFleet} <ArrowRight size={13} />
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )
      ) : (
        <p className="panel notice">
          <Database size={16} />
          {w.noRegionalFleets}
        </p>
      )}

      {visibleConnections.length > PAGE_SIZE && (
        <footer className="table-foot">
          <span>
            {w.pages} {page + 1}
          </span>
          <div>
            <button
              type="button"
              className="button"
              disabled={!page}
              onClick={() => setPage(page - 1)}
            >
              {w.prev}
            </button>
            <button
              type="button"
              className="button"
              disabled={start + PAGE_SIZE >= visibleConnections.length}
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
