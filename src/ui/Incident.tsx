import { useCallback, useState } from "react";
import type { WarehouseIncidentView } from "../../vendor/culprit/app/src/gen/WarehouseIncidentView";
import { api, useRead, useReadDefaults, type ArchiveScope } from "./api";
import {
  activeSection,
  sectionUrl,
  type ArchiveRange,
  type Section,
} from "./navigation";
import { RangeSelection } from "./ArchiveRange";
import { IncidentCase } from "./IncidentCase";
import { IncidentTimeline } from "./IncidentTimeline";
import { PublishedWindow } from "./PublishedWindow";
import { WindowData } from "./WindowData";
import { StateMessage, stamp } from "./shared";
import w from "./en.json";

const tabs: Record<Section, string> = {
  incident: w.progress,
  timeline: w.timeline,
  workload: w.workload,
  operations: w.operations,
  schema: w.schema,
  changes: w.changes,
  coverage: w.collectionCoverage,
};
function Cases({
  scope,
  view,
  revisionId,
}: {
  scope: ArchiveScope;
  view: WarehouseIncidentView;
  revisionId: string | null;
}) {
  const [published, setPublished] = useState(false);
  const { report } = view;
  const cases = report.incidents.filter(
    (item) => !revisionId || item.entry.revision_id === revisionId,
  );
  return (
    <>
      {!report.discovery_complete && <div className="notice">{w.partial}</div>}
      {cases.length === 0 && (
        <div className="panel notice">
          {revisionId ? w.missingCase : w.none}
        </div>
      )}
      {cases.map((item) => (
        <IncidentCase
          key={item.analysis_id + item.entry.revision_id}
          incident={item}
          {...scope}
        />
      ))}
      <button
        className="button"
        type="button"
        aria-expanded={published}
        onClick={() => setPublished((v) => !v)}
      >
        {w.published}
      </button>
      {published && <PublishedWindow {...scope} report={report} />}
      {[
        ...report.gaps.map((g) => g.kind),
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
  revisionId: string | null;
};
function ViewContent({ scope, section, range, view, revisionId }: Content) {
  switch (section) {
    case "changes":
    case "operations":
    case "schema":
      return <PublishedWindow {...scope} report={range} area={section} />;
    case "coverage":
    case "workload":
      return <WindowData {...scope} report={range} view={section} />;
    case "timeline":
      return view && <IncidentTimeline {...scope} report={view.report} />;
    case "incident":
      return (
        view && <Cases scope={scope} view={view} revisionId={revisionId} />
      );
  }
}
export function Incident({
  connection,
  resource,
  around,
  revisionId,
  bounds,
}: ArchiveScope & {
  around: string;
  revisionId: string | null;
  bounds: ArchiveRange | null;
}) {
  const section = activeSection(new URLSearchParams(location.search));
  const { window_page_rows: pageRows } = useReadDefaults();
  const load = useCallback(
    async (signal: AbortSignal): Promise<WarehouseIncidentView | null> => {
      if (!bounds) return api.incident(connection, resource, around, signal);
      if (section !== "incident" && section !== "timeline") return null;
      const page = await api.window(
        connection,
        {
          resource,
          window: { from: bounds.from, until: bounds.until },
          as_of: bounds.recorded_before,
          view: "compatible-workload",
          page_rows: pageRows,
          after: null,
        },
        signal,
      );
      return {
        report: page.incidents,
        analysis_limitations: page.incident_limitations,
      };
    },
    [connection, resource, around, bounds, section, pageRows],
  );
  const result = useRead(load);
  const view = result.status === "ready" ? result.value : null;
  const range = bounds ?? view?.report;
  const name = view?.report.incidents[0]?.display.database_name;
  return (
    <>
      <header className="page-head">
        <div>
          <h1>{name ?? tabs[section]}</h1>
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
          >
            {label}
          </a>
        ))}
      </nav>
      {result.status === "ready" && range ? (
        <ViewContent
          scope={{ connection, resource }}
          section={section}
          view={view}
          range={range}
          revisionId={revisionId}
        />
      ) : (
        <StateMessage
          error={result.status === "error" ? result.message : undefined}
        />
      )}
    </>
  );
}
