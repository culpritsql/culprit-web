import { useCallback, useState } from "react";
import { ChevronRight, Clock3, Fingerprint } from "lucide-react";
import type { DerivedIncident } from "../../vendor/culprit/app/src/gen/DerivedIncident";
import type { DerivedIncidentQuery } from "../../vendor/culprit/app/src/gen/DerivedIncidentQuery";
import type { DiagnosticEvidenceRef } from "../../vendor/culprit/app/src/gen/DiagnosticEvidenceRef";
import type { PublishedResourceSelector } from "../../vendor/culprit/app/src/gen/PublishedResourceSelector";
import { api, useRead, type WarehouseConnectionRef } from "./api";
import { Evidence } from "./Evidence";
import { PublishedWindow } from "./PublishedWindow";
import { ObservationTimes } from "./ObservationTimes";
import { StateMessage, stamp } from "./shared";
import w from "./en.json";

type Archive = { connection: WarehouseConnectionRef; resource: PublishedResourceSelector };

function Queries({ title, items }: { title: string; items: DerivedIncidentQuery[] }) {
  if (!items.length) return null;
  return (
    <section>
      <h3>{title}</h3>
      {items.map((query, i) => (
        <div key={i} className="query">
          <code>{query.sql.state === "available" ? query.sql.text : w.noPayload}</code>
          {query.causal_role && <p>{query.causal_role.explanation.text}</p>}
        </div>
      ))}
    </section>
  );
}

function Case({ incident, connection, resource }: Archive & { incident: DerivedIncident }) {
  const [selected, setSelected] = useState<DiagnosticEvidenceRef | null>(null);
  const refs = [
    incident.revision_reference,
    ...incident.affected_queries.flatMap((q) => q.evidence),
    ...incident.culprit_queries.flatMap((q) => q.evidence),
    ...incident.candidate_queries.flatMap((q) => q.evidence),
  ];
  const originals = [...new Map(refs.map((ref) => [JSON.stringify(ref), ref])).values()];
  const entry = incident.entry;
  const permalink = new URL(location.href);
  permalink.searchParams.set("incident", entry.revision_id);
  return (
    <article className="panel case">
      <div className="case-title">
        <span className="status">
          <i />
          {entry.lifecycle}
        </span>
        <a href={permalink.pathname + permalink.search}>{w.permalink}</a>
      </div>
      <h2>{entry.title}</h2>
      <p className="lead">{incident.victim_summary}</p>
      <ObservationTimes first={entry.first_seen_at} last={entry.last_seen_at} recorded={entry.recorded_at} />
      <div className="case-columns">
        <div>
          {incident.mechanism && (
            <section>
              <h3>{w.mechanism}</h3>
              <p>{incident.mechanism}</p>
            </section>
          )}
          <Queries title={w.affected} items={incident.affected_queries} />
          <Queries title={w.culprit} items={incident.culprit_queries} />
          <Queries title={w.candidate} items={incident.candidate_queries} />
          <section>
            <h3>{w.action}</h3>
            <p>{incident.developer_action}</p>
            <h3>{w.verify}</h3>
            <p>{incident.verification}</p>
          </section>
        </div>
        <aside>
          <h3>
            <Fingerprint size={17} /> {w.orig}
          </h3>
          <small>
            {w.at} · {incident.attribution_status}
          </small>
          {originals.map((ref, i) => (
            <button key={i} className="evidence-button" onClick={() => setSelected(ref)}>
              <span>
                {ref.stream}
                <small>{ref.manifest_sha256.slice(0, 16)}…</small>
              </span>
              <ChevronRight size={15} />
            </button>
          ))}
          {selected && (
            <Evidence
              key={JSON.stringify(selected)}
              reference={selected}
              connection={connection}
              resource={resource}
            />
          )}
        </aside>
      </div>
    </article>
  );
}

export function Incident({
  connection,
  resource,
  around,
  revisionId,
}: Archive & { around: string; revisionId: string | null }) {
  const [time, setTime] = useState(around.slice(0, 16));
  const load = useCallback(
    (signal: AbortSignal) => api.incident(connection, resource, around, signal),
    [connection, resource, around],
  );
  const result = useRead(load);
  const [showWindow, setShowWindow] = useState(false);
  const report = result.status === "ready" ? result.value.report : null;
  const cases = report?.incidents.filter((i) => !revisionId || i.entry.revision_id === revisionId) ?? [];
  return (
    <>
      <header className="page-head">
        <div>
          <h1>{report?.incidents[0]?.display.database_name ?? w.report}</h1>
          <p>
            {w.report} · {stamp(around)}
          </p>
        </div>
      </header>
      <form
        className="window"
        onSubmit={(e) => {
          e.preventDefault();
          const url = new URL(location.href);
          url.searchParams.delete("incident");
          url.searchParams.set("around", new Date(time + "Z").toISOString());
          location.assign(url);
        }}
      >
        <label>
          <Clock3 size={15} />
          {w.windowAround}
          <input type="datetime-local" required value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <button className="button">{w.apply}</button>
      </form>
      {result.status === "ready" ? (
        <>
          {!result.value.report.discovery_complete && <div className="notice">{w.partial}</div>}
          {cases.length === 0 && <div className="panel notice">{revisionId ? w.missingCase : w.none}</div>}
          {cases.map((item) => (
            <Case
              key={item.analysis_id + item.entry.revision_id}
              incident={item}
              connection={connection}
              resource={resource}
            />
          ))}
          <button
            className="button"
            type="button"
            aria-expanded={showWindow}
            onClick={() => setShowWindow((open) => !open)}
          >
            {w.published}
          </button>
          {showWindow && (
            <PublishedWindow connection={connection} resource={resource} report={result.value.report} />
          )}
          {[
            ...result.value.report.gaps.map((g) => g.kind),
            ...result.value.analysis_limitations.flatMap((l) => l.reasons),
          ].map((reason, i) => (
            <p className="muted" key={i}>
              {reason}
            </p>
          ))}
        </>
      ) : (
        <StateMessage error={result.status === "error" ? result.message : undefined} />
      )}
    </>
  );
}
