import { useState } from "react";
import type { IncidentReadReport } from "../../vendor/culprit/app/src/gen/IncidentReadReport";
import type { DiagnosticEvidenceRef } from "../../vendor/culprit/app/src/gen/DiagnosticEvidenceRef";
import type { PublishedResourceSelector, WarehouseConnectionRef } from "./api";
import { Evidence } from "./Evidence";
import { stamp } from "./shared";
import w from "./en.json";

export function IncidentTimeline({
  report,
  connection,
  resource,
}: {
  report: IncidentReadReport;
  connection: WarehouseConnectionRef;
  resource: PublishedResourceSelector;
}) {
  const [selected, setSelected] = useState<DiagnosticEvidenceRef | null>(null);
  const entries = [...report.history.entries].sort(
    (a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at),
  );
  return (
    <section className="panel case">
      <h2>{w.incidentTimeline}</h2>
      <p className="muted">{w.timelineClock}</p>
      {!entries.length && <p>{w.none}</p>}
      <ol className="event-list">
        {entries.map((entry) => (
          <li key={entry.revision_id}>
            <time dateTime={entry.recorded_at}>{stamp(entry.recorded_at)}</time>
            <div>
              <span className="status">{entry.lifecycle}</span>
              <h3>{entry.title}</h3>
              <small>
                {w.first} {stamp(entry.first_seen_at)} · {w.last}{" "}
                {stamp(entry.last_seen_at)}
              </small>
              <p>{entry.next_step}</p>
              {entry.original && (
                <button
                  className="button"
                  onClick={() => setSelected(entry.original)}
                >
                  {w.inspectRevision} {entry.revision}
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
      {selected && (
        <Evidence
          key={selected.record_id}
          reference={selected}
          resource={resource}
          connection={connection}
        />
      )}
      {report.history.limitations.map((reason, i) => (
        <p key={i} className="muted">
          {reason}
        </p>
      ))}
    </section>
  );
}
