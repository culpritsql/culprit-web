import { useState } from "react";
import { ChevronRight, Fingerprint } from "lucide-react";
import type { DerivedIncident } from "../../vendor/culprit/app/src/gen/DerivedIncident";
import type { DerivedIncidentQuery } from "../../vendor/culprit/app/src/gen/DerivedIncidentQuery";
import type { DiagnosticEvidenceRef } from "../../vendor/culprit/app/src/gen/DiagnosticEvidenceRef";
import type { ArchiveScope as Archive } from "./api";
import { Evidence } from "./Evidence";
import { ObservationTimes } from "./ObservationTimes";
import w from "./en.json";
function Queries({
  title,
  items,
}: {
  title: string;
  items: DerivedIncidentQuery[];
}) {
  if (!items.length) return null;
  return (
    <section>
      <h3>{title}</h3>
      {items.map((query, i) => (
        <div key={i} className="query">
          <code>
            {query.sql.state === "available" ? query.sql.text : w.noPayload}
          </code>
          {query.causal_role && <p>{query.causal_role.explanation.text}</p>}
        </div>
      ))}
    </section>
  );
}

export function IncidentCase({
  incident,
  connection,
  resource,
}: Archive & { incident: DerivedIncident }) {
  const [selected, setSelected] = useState<DiagnosticEvidenceRef | null>(null);
  const refs = [
    incident.revision_reference,
    ...incident.affected_queries.flatMap((q) => q.evidence),
    ...incident.culprit_queries.flatMap((q) => q.evidence),
    ...incident.candidate_queries.flatMap((q) => q.evidence),
  ];
  const originals = [
    ...new Map(refs.map((ref) => [JSON.stringify(ref), ref])).values(),
  ];
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
      <ObservationTimes
        first={entry.first_seen_at}
        last={entry.last_seen_at}
        recorded={entry.recorded_at}
      />
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
            <button
              key={i}
              className="evidence-button"
              onClick={() => setSelected(ref)}
            >
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
