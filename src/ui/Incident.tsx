import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  FolderGit2,
  Radio,
} from "lucide-react";
import type { Engine } from "../../vendor/culprit/app/src/gen/Engine";
import type { WarehouseFleetRow } from "../../vendor/culprit/app/src/gen/WarehouseFleetRow";
import type { WarehouseIncidentView } from "../../vendor/culprit/app/src/gen/WarehouseIncidentView";
import type { WarehouseWindowReport } from "../../vendor/culprit/app/src/gen/WarehouseWindowReport";
import {
  api,
  useRead,
  useReadDefaults,
  type ArchiveScope,
  type PublishedResourceSelector,
} from "./api";
import { EngineBadge } from "./EngineBadge";
import {
  activeSection,
  investigationUrl,
  sectionUrl,
  spaClick,
  useLocationHref,
  type ArchiveRange,
  type Section,
} from "./navigation";
import { RangeSelection } from "./ArchiveRange";
import { ErrorBoundary } from "./ErrorBoundary";
import { IncidentCase } from "./IncidentCase";
import { IncidentTimeline } from "./IncidentTimeline";
import { useLiveTick } from "./livePulse";
import { MissionTimeline } from "./MissionTimeline";
import { PublishedWindow } from "./PublishedWindow";
import { Coverage, WindowData } from "./WindowData";
import {
  StateMessage,
  formatDurationMs,
  humanizeGap,
  pct,
  relativeAge,
  stamp,
} from "./shared";
import w from "./en.json";

export interface PoolSiblingMeta {
  name: string;
  selector: PublishedResourceSelector;
  around: string;
  activeIncidents: number;
  cpuPct: number | null;
  dominantWait: string | null;
}

export interface KnownDatabaseMeta {
  name: string;
  engine: Engine | null;
  environment?: string | null;
  freshness?: WarehouseFleetRow["freshness"];
  sharedGroup?: WarehouseFleetRow["shared_group"];
  activeIncidents?: number;
  cpuPct?: number | null;
  memoryPct?: number | null;
  dominantWait?: string | null;
  latestCollectedUntil?: string;
  poolSiblings?: PoolSiblingMeta[];
}

const tabs: Record<Section, string> = {
  incident: w.progress,
  resources: w.resourcesTab,
  workload: w.workload,
  schema: w.schema,
  timeline: w.timeline,
};

function SituationBanner({
  view,
  windowReport,
  knownMeta,
}: {
  view: WarehouseIncidentView;
  windowReport: WarehouseWindowReport | null;
  knownMeta?: KnownDatabaseMeta | null;
}) {
  const { report } = view;
  const incidents = report.incidents;
  const activeCases = incidents.filter((i) => i.entry.lifecycle === "active");
  const resolvedCases = incidents.filter(
    (i) => i.entry.lifecycle === "resolved",
  );
  const isStale =
    knownMeta?.freshness === "stale" || knownMeta?.freshness === "partial";

  const latestSample = windowReport?.telemetry?.resources
    .flatMap((r) => r.samples)
    .at(-1);
  const latestBlocking = windowReport?.telemetry?.activity
    .map((a) => a.blocking)
    .filter((b): b is NonNullable<typeof b> => Boolean(b))
    .at(-1);
  const headChain = latestBlocking?.blocking?.chains[0];
  const deadlocks = windowReport?.telemetry?.deadlocks ?? [];
  const latestRep = windowReport?.telemetry?.replication?.at(-1)?.report;

  if (isStale) {
    const lastCapture = knownMeta?.latestCollectedUntil ?? report.until;
    return (
      <section
        className="situation-banner situation-stale"
        aria-label="Database telemetry freshness alert"
      >
        <div className="situation-main">
          <span className="situation-pill pill-stale">
            <AlertTriangle size={13} />
            TELEMETRY {knownMeta?.freshness?.toUpperCase()}
          </span>
          <div className="situation-copy">
            <strong>
              Last archive capture was{" "}
              {relativeAge(lastCapture, report.recorded_before) ||
                stamp(lastCapture)}
            </strong>
            <span>
              Metrics below reflect {stamp(lastCapture)} — verify collector
              connectivity before trusting low resource numbers.
            </span>
          </div>
        </div>
      </section>
    );
  }

  if (activeCases.length > 0) {
    const primary = activeCases[0]!;
    const startedAge = relativeAge(
      primary.entry.first_seen_at,
      report.recorded_before,
    );
    const spanMs =
      Date.parse(primary.entry.last_seen_at) -
      Date.parse(primary.entry.first_seen_at);

    return (
      <section
        className="situation-banner situation-ongoing"
        aria-label="Live database situation"
      >
        <div className="situation-main">
          <span className="situation-pill pill-ongoing">
            <Radio size={13} />
            ONGOING INCIDENT
          </span>
          <div className="situation-copy">
            <strong>
              {activeCases.length === 1
                ? primary.entry.title
                : `${activeCases.length} active incidents under triage`}
            </strong>
            <span>
              Started {startedAge || stamp(primary.entry.first_seen_at)}
              {spanMs > 0 ? ` · active for ${formatDurationMs(spanMs)}` : ""}
              {headChain
                ? ` · ${headChain.waiters} blocked behind Session ${headChain.head}${headChain.tree.context?.application ? ` (${headChain.tree.context.application})` : ""}`
                : deadlocks.length > 0
                  ? ` · ${deadlocks.length} deadlock cycles captured`
                  : latestRep
                    ? ` · ${latestRep.summary}`
                    : ""}
            </span>
          </div>
        </div>
        {latestSample && (
          <div className="situation-kpis">
            <span>
              CPU <b>{pct(latestSample.cpu_pct)}</b>
            </span>
            <span>
              MEM <b>{pct(latestSample.memory_pct)}</b>
            </span>
            {latestSample.data_io_pct != null && (
              <span>
                I/O <b>{pct(latestSample.data_io_pct)}</b>
              </span>
            )}
          </div>
        )}
      </section>
    );
  }

  if (resolvedCases.length > 0) {
    const latest = resolvedCases[0]!;
    const resolvedAge = relativeAge(
      latest.entry.last_seen_at,
      report.recorded_before,
    );
    const spanMs =
      Date.parse(latest.entry.last_seen_at) -
      Date.parse(latest.entry.first_seen_at);

    return (
      <section
        className="situation-banner situation-recovered"
        aria-label="Live database situation"
      >
        <div className="situation-main">
          <span className="situation-pill pill-recovered">
            <CheckCircle2 size={13} />
            RECOVERED · ROOT CAUSE RETAINED
          </span>
          <div className="situation-copy">
            <strong>
              Resolved {resolvedAge || stamp(latest.entry.last_seen_at)}
              {spanMs > 0 ? ` · lasted ${formatDurationMs(spanMs)}` : ""}
            </strong>
            <span>
              {headChain
                ? `Peak impact: ${headChain.waiters} sessions blocked (${formatDurationMs(headChain.longest_wait_ms ?? 0)} max wait) behind ${headChain.tree.context?.application ?? `Session ${headChain.head}`}`
                : "Immediate contention drained — causal chain and code remediation preserved below."}
            </span>
          </div>
        </div>
        {latestSample && (
          <div className="situation-kpis">
            <span>
              CPU <b>{pct(latestSample.cpu_pct)}</b>
            </span>
            <span>
              MEM <b>{pct(latestSample.memory_pct)}</b>
            </span>
          </div>
        )}
      </section>
    );
  }

  return null;
}

function Cases({
  scope,
  view,
  windowReport,
  revisionId,
  knownMeta,
}: {
  scope: ArchiveScope;
  view: WarehouseIncidentView;
  windowReport: WarehouseWindowReport | null;
  revisionId: string | null;
  knownMeta?: KnownDatabaseMeta | null;
}) {
  const [published, setPublished] = useState(false);
  const { report } = view;
  const cases = report.incidents.filter(
    (item) => !revisionId || item.entry.revision_id === revisionId,
  );
  const latestSample = windowReport?.telemetry?.resources
    .flatMap((r) => r.samples)
    .at(-1);
  const latestActivity = windowReport?.telemetry?.activity?.at(-1);
  const latestStorage =
    windowReport?.telemetry?.storage?.at(-1)?.report.file_summary;
  const latestRep = windowReport?.telemetry?.replication?.at(-1)?.report;
  const autoShowPublished = cases.length === 0 && !revisionId;
  const showPublished = published || autoShowPublished;

  const storageSummary =
    latestStorage?.data_used_bytes && latestStorage.data_allocated_bytes
      ? `${(Number(latestStorage.data_used_bytes) / 1024 ** 3).toFixed(1)} / ${(Number(latestStorage.data_allocated_bytes) / 1024 ** 3).toFixed(0)} GiB`
      : null;

  return (
    <>
      <SituationBanner
        view={view}
        windowReport={windowReport}
        knownMeta={knownMeta}
      />
      <MissionTimeline
        windowReport={windowReport}
        incidentReport={report}
        range={report}
      />
      {!report.discovery_complete && <div className="notice">{w.partial}</div>}
      {cases.length === 0 && (
        <section className="panel healthy-window-card">
          <div className="healthy-window-head">
            <span className="healthy-icon">
              <CheckCircle2 size={20} />
            </span>
            <div>
              <h2>{revisionId ? w.missingCase : w.none}</h2>
              <p className="muted">
                Window {stamp(report.from)} – {stamp(report.until)}
                {latestRep ? ` · ${latestRep.summary}` : ""}
              </p>
            </div>
          </div>
          {latestSample && (
            <div className="healthy-metrics-row">
              <span>
                Latest CPU <b>{pct(latestSample.cpu_pct)}</b>
              </span>
              <span>
                Memory <b>{pct(latestSample.memory_pct)}</b>
              </span>
              {latestSample.data_io_pct != null && (
                <span>
                  Data I/O <b>{pct(latestSample.data_io_pct)}</b>
                </span>
              )}
              {latestActivity && (
                <span>
                  Active sessions <b>{latestActivity.active_sessions}</b>
                </span>
              )}
              {storageSummary && (
                <span>
                  Storage <b>{storageSummary}</b>
                </span>
              )}
            </div>
          )}
          <div className="healthy-quick-links">
            <a
              className="chip"
              href={sectionUrl("resources")}
              onClick={spaClick}
            >
              Inspect CPU, memory &amp; waits <ArrowRight size={12} />
            </a>
            <a
              className="chip"
              href={sectionUrl("workload")}
              onClick={spaClick}
            >
              Top SQL workload <ArrowRight size={12} />
            </a>
            <a className="chip" href={sectionUrl("schema")} onClick={spaClick}>
              Browse schema &amp; index catalog <ArrowRight size={12} />
            </a>
          </div>
        </section>
      )}
      {cases.map((item) => (
        <IncidentCase
          key={item.analysis_id + item.entry.revision_id}
          incident={item}
          windowReport={windowReport}
          dbName={knownMeta?.name}
          engine={knownMeta?.engine}
          environment={knownMeta?.environment}
          referenceIso={report.recorded_before}
          {...scope}
        />
      ))}
      {!autoShowPublished && (
        <div className="published-toggle-bar">
          <button
            className="button"
            type="button"
            aria-expanded={published}
            onClick={() => setPublished((v) => !v)}
          >
            {w.published}
          </button>
        </div>
      )}
      {showPublished && <PublishedWindow {...scope} report={report} />}
      {[
        ...report.gaps.map((g) => humanizeGap(g.kind)),
        ...view.analysis_limitations.flatMap((l) => l.reasons),
      ].map((reason, i) => (
        <p className="muted" key={i}>
          {reason}
        </p>
      ))}
    </>
  );
}

type Content = {
  scope: ArchiveScope;
  section: Section;
  range: ArchiveRange;
  view: WarehouseIncidentView | null;
  windowReport: WarehouseWindowReport | null;
  revisionId: string | null;
  knownMeta?: KnownDatabaseMeta | null;
};

function ViewContent({
  scope,
  section,
  range,
  view,
  windowReport,
  revisionId,
  knownMeta,
}: Content) {
  switch (section) {
    case "schema":
      return <PublishedWindow {...scope} report={range} showCatalog />;
    case "workload":
    case "resources":
      return <WindowData {...scope} report={range} view={section} />;
    case "timeline":
      return (
        view && (
          <div className="timeline-coverage-stack">
            <MissionTimeline
              windowReport={windowReport}
              incidentReport={view.report}
              range={range}
            />
            <IncidentTimeline
              {...scope}
              report={view.report}
              windowReport={windowReport}
            />
            {windowReport && (
              <Coverage originals={windowReport.originals} range={range} />
            )}
          </div>
        )
      );
    case "incident":
      return (
        view && (
          <Cases
            scope={scope}
            view={view}
            windowReport={windowReport}
            revisionId={revisionId}
            knownMeta={knownMeta}
          />
        )
      );
  }
}

interface TabBadges {
  incident?: number;
  incidentActive?: boolean;
  resources?: number;
  workload?: number;
  schema?: number;
  timeline?: number;
}

export function Incident({
  connection,
  resource,
  around,
  revisionId,
  bounds,
  knownMeta,
}: ArchiveScope & {
  around: string;
  revisionId: string | null;
  bounds: ArchiveRange | null;
  knownMeta?: KnownDatabaseMeta | null;
}) {
  useLocationHref();
  const liveTick = useLiveTick();
  const section = activeSection();
  const { window_page_rows: pageRows } = useReadDefaults();
  const [cachedBadges, setCachedBadges] = useState<{
    key: string;
    badges: TabBadges;
  } | null>(null);

  const boundsFrom = bounds?.from ?? null;
  const boundsUntil = bounds?.until ?? null;
  const boundsCutoff = bounds?.recorded_before ?? null;

  const load = useCallback(
    async (
      signal: AbortSignal,
    ): Promise<{
      incident: WarehouseIncidentView | null;
      windowReport: WarehouseWindowReport | null;
    }> => {
      void liveTick;
      if (!boundsFrom || !boundsUntil || !boundsCutoff) {
        const incident = await api.incident(
          connection,
          resource,
          around,
          signal,
        );
        if (section === "incident" || section === "timeline") {
          const windowReport = await api
            .window(
              connection,
              {
                resource,
                window: {
                  from: incident.report.from,
                  until: incident.report.until,
                },
                as_of: incident.report.recorded_before,
                view: "compatible-workload",
                page_rows: pageRows,
                after: null,
              },
              signal,
            )
            .catch(() => null);
          return { incident, windowReport };
        }
        return { incident, windowReport: null };
      }
      if (section !== "incident" && section !== "timeline") {
        return { incident: null, windowReport: null };
      }
      const page = await api.window(
        connection,
        {
          resource,
          window: { from: boundsFrom, until: boundsUntil },
          as_of: boundsCutoff,
          view: "compatible-workload",
          page_rows: pageRows,
          after: null,
        },
        signal,
      );
      return {
        incident: {
          report: page.incidents,
          analysis_limitations: page.incident_limitations,
        },
        windowReport: page,
      };
    },
    [
      connection,
      resource,
      around,
      boundsFrom,
      boundsUntil,
      boundsCutoff,
      section,
      pageRows,
      liveTick,
    ],
  );

  const dbScopeKey = `${connection.name}:${resource.database}`;
  const result = useRead(load, `incident:${dbScopeKey}:${section}`);
  const view = result.status === "ready" ? result.value.incident : null;
  const windowReport =
    result.status === "ready" ? result.value.windowReport : null;
  const range = bounds ?? view?.report;

  useEffect(() => {
    if (!view && !windowReport) return;
    const incList = view?.report.incidents ?? windowReport?.incidents.incidents ?? [];
    const activeAny = incList.some((i) => i.entry.lifecycle === "active");
    const waitingCount =
      windowReport?.telemetry?.activity
        .map((a) => a.blocking?.blocking?.waiting ?? 0)
        .reduce((m, v) => Math.max(m, v), 0) ?? 0;
    const deadlockCount = windowReport?.telemetry?.deadlocks.length ?? 0;
    const queries =
      windowReport?.workload.kind === "evaluated"
        ? (windowReport.workload.analysis.sections[0]?.analysis.workload
            ?.queries ?? [])
        : [];
    const planFlips = queries.filter(
      (q) => q.plan && q.plan_history?.captured_plan,
    ).length;
    const advisorItems = (windowReport?.published ?? []).reduce(
      (sum, p) => sum + p.findings.length + p.changes.length,
      0,
    );
    const revCount =
      (view?.report.history.entries.length ?? 0) +
      (windowReport?.originals.length ?? 0);

    setCachedBadges((prev) => {
      const base = prev?.key === dbScopeKey ? prev.badges : {};
      return {
        key: dbScopeKey,
        badges: {
          incident: incList.length || base.incident,
          incidentActive: activeAny || base.incidentActive,
          resources:
            waitingCount + deadlockCount > 0
              ? waitingCount + deadlockCount
              : base.resources,
          workload: planFlips > 0 ? planFlips : base.workload,
          schema: advisorItems > 0 ? advisorItems : base.schema,
          timeline: revCount > 0 ? revCount : base.timeline,
        },
      };
    });
  }, [dbScopeKey, view, windowReport]);

  const badges = cachedBadges?.key === dbScopeKey ? cachedBadges.badges : {};

  const firstDisplay = view?.report.incidents[0]?.display;
  const dbTitle =
    knownMeta?.name ??
    firstDisplay?.database_name ??
    firstDisplay?.connection_alias ??
    tabs[section];
  const envBadge = knownMeta?.environment ?? firstDisplay?.environment ?? null;
  const sharedGroup = knownMeta?.sharedGroup ?? null;
  const poolSiblings = knownMeta?.poolSiblings ?? [];
  const noisySibling = poolSiblings.find(
    (s) => s.activeIncidents > 0 || (s.cpuPct ?? 0) >= 85,
  );

  return (
    <>
      <header className="page-head db-page-head">
        <div>
          <div className="db-head-title-row">
            <h1>{dbTitle}</h1>
            {knownMeta?.engine && <EngineBadge engine={knownMeta.engine} />}
            {envBadge && (
              <span className="env-pill">
                <i className={`env-dot env-${envBadge.toLowerCase()}`} />
                {envBadge}
              </span>
            )}
            {sharedGroup && (
              <span
                className="pool-context-pill"
                title={`Shared ${sharedGroup.member_kind}: ${sharedGroup.label}`}
              >
                <FolderGit2 size={12} />
                <span>
                  {sharedGroup.label} · {poolSiblings.length + 1} DBs
                </span>
              </span>
            )}
            {noisySibling && (
              <a
                className="noisy-neighbor-pill"
                href={investigationUrl(
                  connection,
                  noisySibling.selector,
                  noisySibling.around,
                  "incident",
                )}
                onClick={spaClick}
              >
                <AlertTriangle size={12} />
                <span>
                  Sibling {noisySibling.name}:{" "}
                  {noisySibling.activeIncidents > 0
                    ? `${noisySibling.activeIncidents} active`
                    : `CPU ${noisySibling.cpuPct}%`}
                </span>
                <ArrowUpRight size={12} />
              </a>
            )}
          </div>
          <p>
            {w.report} · {stamp(around)}
            {range && (
              <span className="head-rel-age">
                {" "}
                · window {relativeAge(around, range.recorded_before)}
              </span>
            )}
          </p>
        </div>
        {range && <RangeSelection range={range} />}
      </header>

      <nav className="tabs" aria-label={w.resourceViews}>
        {(Object.entries(tabs) as [Section, string][]).map(([key, label]) => {
          const count = badges[key];
          const isDanger =
            (key === "incident" && badges.incidentActive) ||
            (key === "resources" && (count ?? 0) > 0);
          return (
            <a
              key={key}
              aria-current={key === section ? "page" : undefined}
              href={sectionUrl(key)}
              onClick={spaClick}
            >
              <span>{label}</span>
              {count !== undefined && count > 0 && (
                <span
                  className={`tab-badge ${isDanger ? "tab-badge-danger" : ""}`}
                  aria-hidden="true"
                >
                  {count}
                </span>
              )}
            </a>
          );
        })}
      </nav>

      {result.status === "ready" && range ? (
        <ErrorBoundary
          resetKey={`${connection.name}:${resource.database}:${section}`}
        >
          <ViewContent
            scope={{ connection, resource }}
            section={section}
            view={view}
            windowReport={windowReport}
            range={range}
            revisionId={revisionId}
            knownMeta={knownMeta}
          />
        </ErrorBoundary>
      ) : (
        <StateMessage
          error={result.status === "error" ? result.message : undefined}
        />
      )}
    </>
  );
}
