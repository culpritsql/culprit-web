import { useMemo, useState } from "react";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  GitCommitHorizontal,
  History,
  ShieldAlert,
} from "lucide-react";
import type { IncidentReadReport } from "../../vendor/culprit/app/src/gen/IncidentReadReport";
import type { WarehouseWindowReport } from "../../vendor/culprit/app/src/gen/WarehouseWindowReport";
import type { DiagnosticEvidenceRef } from "../../vendor/culprit/app/src/gen/DiagnosticEvidenceRef";
import type { PublishedResourceSelector, WarehouseConnectionRef } from "./api";
import { Evidence } from "./Evidence";
import { stamp } from "./shared";
import w from "./en.json";

type EventFilter = "all" | "revision" | "change" | "deadlock";

type UnifiedEvent =
  | {
      id: string;
      kind: "revision";
      at: string;
      lifecycle: string;
      title: string;
      subtitle: string;
      detail: string;
      revision?: string;
      original: DiagnosticEvidenceRef | null;
    }
  | {
      id: string;
      kind: "change";
      at: string;
      changeKind: string;
      title: string;
      detail: string | null;
    }
  | {
      id: string;
      kind: "deadlock";
      at: string;
      pattern: string;
      title: string;
      detail: string;
    };

export function IncidentTimeline({
  report,
  windowReport,
  connection,
  resource,
}: {
  report: IncidentReadReport;
  windowReport?: WarehouseWindowReport | null;
  connection: WarehouseConnectionRef;
  resource: PublishedResourceSelector;
}) {
  const [selected, setSelected] = useState<DiagnosticEvidenceRef | null>(null);
  const [filter, setFilter] = useState<EventFilter>("all");

  const items = useMemo<UnifiedEvent[]>(() => {
    const out: UnifiedEvent[] = [];
    for (const entry of report.history.entries) {
      out.push({
        id: "rev:" + entry.revision_id,
        kind: "revision",
        at: entry.recorded_at,
        lifecycle: entry.lifecycle,
        title: entry.title,
        subtitle: `${w.first} ${stamp(entry.first_seen_at)} · ${w.last} ${stamp(entry.last_seen_at)}`,
        detail: entry.next_step,
        revision: entry.revision,
        original: entry.original,
      });
    }
    for (const pub of windowReport?.published ?? []) {
      for (const ch of pub.changes) {
        const ev = ch.change.change;
        out.push({
          id: "chg:" + ev.id + ev.at,
          kind: "change",
          at: ev.at,
          changeKind: ev.kind,
          title: ev.title.text,
          detail: ev.detail?.text ?? null,
        });
      }
    }
    for (const dl of windowReport?.telemetry?.deadlocks ?? []) {
      if (dl.at) {
        out.push({
          id: "dl:" + dl.id,
          kind: "deadlock",
          at: dl.at,
          pattern: dl.pattern,
          title: dl.headline || `Deadlock cycle (${dl.pattern})`,
          detail: dl.explanation,
        });
      }
    }
    return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }, [report.history.entries, windowReport]);

  const filtered = useMemo(
    () =>
      filter === "all" ? items : items.filter((item) => item.kind === filter),
    [items, filter],
  );

  const hasExtraStreams = items.some((i) => i.kind !== "revision");

  return (
    <section className="panel case timeline-panel">
      <header className="timeline-head">
        <div className="panel-head-copy">
          <h2 className="icon-heading">
            <History size={19} />
            {w.incidentTimeline}
          </h2>
          <small>{w.timelineClock}</small>
        </div>

        {hasExtraStreams && (
          <div className="filter-chips" role="group" aria-label="Event type">
            {(
              [
                ["all", `All events (${items.length})`],
                [
                  "revision",
                  `Revisions (${items.filter((x) => x.kind === "revision").length})`,
                ],
                [
                  "change",
                  `Changes (${items.filter((x) => x.kind === "change").length})`,
                ],
                [
                  "deadlock",
                  `Deadlocks (${items.filter((x) => x.kind === "deadlock").length})`,
                ],
              ] as [EventFilter, string][]
            ).map(([key, label]) => (
              <button
                type="button"
                key={key}
                className="chip"
                data-active={filter === key}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </header>

      {!filtered.length ? (
        <div className="timeline-empty">{w.none}</div>
      ) : (
        <ol className="timeline-stream">
          {filtered.map((item) => {
            const tone =
              item.kind === "deadlock"
                ? "danger"
                : item.kind === "change"
                  ? "partial"
                  : item.lifecycle === "active"
                    ? "danger"
                    : item.lifecycle === "resolved"
                      ? "observed"
                      : "partial";
            return (
              <li key={item.id} className="timeline-stream-item">
                <div className="timeline-stream-time">
                  <time dateTime={item.at}>{stamp(item.at)}</time>
                </div>
                <div className={`timeline-stream-node node-${tone}`}>
                  {item.kind === "deadlock" ? (
                    <ShieldAlert size={13} />
                  ) : item.kind === "change" ? (
                    <GitCommitHorizontal size={13} />
                  ) : (
                    <Activity size={13} />
                  )}
                </div>
                <div className="timeline-stream-card">
                  <div className="timeline-card-badges">
                    <span className={`status ${tone}`}>
                      <i />
                      {item.kind === "revision"
                        ? item.lifecycle
                        : item.kind === "deadlock"
                          ? `deadlock · ${item.pattern}`
                          : item.changeKind}
                    </span>
                    {item.kind === "revision" && item.revision !== undefined && (
                      <span className="case-meta-pill">
                        Revision #{item.revision}
                      </span>
                    )}
                  </div>
                  <h3>{item.title}</h3>
                  {item.kind === "revision" && (
                    <small className="timeline-sub">{item.subtitle}</small>
                  )}
                  {item.detail && <p>{item.detail}</p>}
                  {item.kind === "revision" && item.original && (
                    <button
                      type="button"
                      className="button"
                      onClick={() => setSelected(item.original)}
                    >
                      {w.inspectRevision} {item.revision}
                      <ChevronRight size={13} />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {selected && (
        <div className="timeline-evidence-drawer">
          <button
            type="button"
            className="button"
            onClick={() => setSelected(null)}
          >
            <ChevronLeft size={13} /> Close evidence
          </button>
          <Evidence
            key={selected.record_id}
            reference={selected}
            resource={resource}
            connection={connection}
          />
        </div>
      )}

      {report.history.limitations.length > 0 && (
        <details className="provenance-details">
          <summary>
            Archive provenance &amp; verification notes (
            {report.history.limitations.length})
          </summary>
          <div className="provenance-body">
            {report.history.limitations.map((reason, i) => (
              <p key={i} className="muted">
                {reason}
              </p>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
