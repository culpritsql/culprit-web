import { useCallback, useState } from "react";
import { CheckCircle2, ArrowRight } from "lucide-react";
import type { Engine } from "../../vendor/culprit/app/src/gen/Engine";
import type { WarehouseIncidentView } from "../../vendor/culprit/app/src/gen/WarehouseIncidentView";
import type { WarehouseWindowReport } from "../../vendor/culprit/app/src/gen/WarehouseWindowReport";
import {
  api,
  useRead,
  useReadDefaults,
  type ArchiveScope,
} from "./api";
import { EngineBadge } from "./EngineBadge";
import {
  activeSection,
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
import { WindowData } from "./WindowData";
import { StateMessage, humanizeGap, pct, stamp } from "./shared";
import w from "./en.json";

export interface KnownDatabaseMeta {
  name: string;
  engine: Engine | null;
  environment?: string | null;
}

const tabs: Record<Section, string> = {
  incident: w.progress,
  resources: w.resourcesTab,
  workload: w.workload,
  timeline: w.timeline,
  operations: w.operations,
  schema: w.schema,
  changes: w.changes,
  coverage: w.collectionCoverage,
};

function Cases({
  scope,
  view,
  windowReport,
  revisionId,
}: {
  scope: ArchiveScope;
  view: WarehouseIncidentView;
  windowReport: WarehouseWindowReport | null;
  revisionId: string | null;
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
            <a className="chip" href={sectionUrl("resources")} onClick={spaClick}>
              Inspect CPU, memory &amp; waits <ArrowRight size={12} />
            </a>
            <a className="chip" href={sectionUrl("workload")} onClick={spaClick}>
              Top SQL workload <ArrowRight size={12} />
            </a>
            <a className="chip" href={sectionUrl("schema")} onClick={spaClick}>
              Schema &amp; index catalog <ArrowRight size={12} />
            </a>
          </div>
        </section>
      )}
      {cases.map((item) => (
        <IncidentCase
          key={item.analysis_id + item.entry.revision_id}
          incident={item}
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
};

function ViewContent({
  scope,
  section,
  range,
  view,
  windowReport,
  revisionId,
}: Content) {
  switch (section) {
    case "changes":
    case "operations":
    case "schema":
      return <PublishedWindow {...scope} report={range} area={section} />;
    case "coverage":
    case "workload":
    case "resources":
      return <WindowData {...scope} report={range} view={section} />;
    case "timeline":
      return (
        view && (
          <IncidentTimeline
            {...scope}
            report={view.report}
            windowReport={windowReport}
          />
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
          />
        )
      );
  }
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

  const result = useRead(
    load,
    `incident:${connection.name}:${resource.database}:${section}`,
  );
  const view = result.status === "ready" ? result.value.incident : null;
  const windowReport =
    result.status === "ready" ? result.value.windowReport : null;
  const range = bounds ?? view?.report;
  const firstDisplay = view?.report.incidents[0]?.display;
  const dbTitle =
    knownMeta?.name ??
    firstDisplay?.database_name ??
    firstDisplay?.connection_alias ??
    tabs[section];
  const envBadge = knownMeta?.environment ?? firstDisplay?.environment ?? null;

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
          </div>
          <p>
            {w.report} · {stamp(around)}
          </p>
        </div>
        {range && <RangeSelection range={range} />}
      </header>
      <nav className="tabs" aria-label={w.resourceViews}>
        {(Object.entries(tabs) as [Section, string][]).map(([key, label]) => (
          <a
            key={key}
            aria-current={key === section ? "page" : undefined}
            href={sectionUrl(key)}
            onClick={spaClick}
          >
            {label}
          </a>
        ))}
      </nav>
      {result.status === "ready" && range ? (
        <ErrorBoundary resetKey={`${connection.name}:${resource.database}:${section}`}>
          <ViewContent
            scope={{ connection, resource }}
            section={section}
            view={view}
            windowReport={windowReport}
            range={range}
            revisionId={revisionId}
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
