import { lazy, Suspense, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  Fingerprint,
  Link2,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import type { DerivedIncident } from "../../vendor/culprit/app/src/gen/DerivedIncident";
import type { DerivedIncidentQuery } from "../../vendor/culprit/app/src/gen/DerivedIncidentQuery";
import type { DiagnosticEvidenceRef } from "../../vendor/culprit/app/src/gen/DiagnosticEvidenceRef";
import type { ArchiveScope as Archive } from "./api";
import { Evidence } from "./Evidence";
import { spaClick } from "./navigation";
import { ObservationTimes } from "./ObservationTimes";
import w from "./en.json";

const LazySql = lazy(async () => {
  const [mod] = await Promise.all([
    import("@culpritsql/plan-viewer"),
    import("@culpritsql/plan-viewer/styles.css"),
  ]);
  return { default: mod.Sql };
});

function formatIncidentDuration(first: string, last: string): string | null {
  const ms = Date.parse(last) - Date.parse(first);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s span`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem ? `${min}m ${rem}s span` : `${min}m span`;
}

function Queries({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "affected" | "culprit" | "candidate";
  items: DerivedIncidentQuery[];
}) {
  if (!items.length) return null;
  return (
    <section className="case-section">
      <h3 className="case-section-heading">{title}</h3>
      {items.map((query, i) => (
        <div key={i} className={`query query-${tone}`}>
          {query.sql.state === "available" ? (
            <Suspense fallback={<code>{query.sql.text}</code>}>
              <LazySql text={query.sql.text} pretty />
            </Suspense>
          ) : (
            <code className="sql-unavailable-pill">{w.noPayload}</code>
          )}
          {query.causal_role && (
            <p className="query-role-note">{query.causal_role.explanation.text}</p>
          )}
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
  const lifecycleTone =
    entry.lifecycle === "active"
      ? "danger"
      : entry.lifecycle === "resolved"
        ? "observed"
        : "partial";
  const spanLabel = formatIncidentDuration(
    entry.first_seen_at,
    entry.last_seen_at,
  );

  return (
    <article className="panel case">
      <div className="case-title">
        <div className="case-badges">
          <span className={`status ${lifecycleTone}`}>
            <i />
            {entry.lifecycle}
          </span>
          <span className="case-meta-pill">
            <ShieldCheck size={12} />
            {incident.attribution_status}
          </span>
          {spanLabel && <span className="case-meta-pill">{spanLabel}</span>}
        </div>
        <a
          className="permalink-chip"
          href={permalink.pathname + permalink.search}
          onClick={spaClick}
        >
          <Link2 size={13} />
          {w.permalink}
        </a>
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
            <section className="case-section mechanism-callout">
              <h3 className="case-section-heading">{w.mechanism}</h3>
              <p>{incident.mechanism}</p>
            </section>
          )}
          <Queries
            title={w.affected}
            tone="affected"
            items={incident.affected_queries}
          />
          <Queries
            title={w.culprit}
            tone="culprit"
            items={incident.culprit_queries}
          />
          <Queries
            title={w.candidate}
            tone="candidate"
            items={incident.candidate_queries}
          />
          <section className="case-section action-grid">
            <div className="action-box action-fix">
              <h3>
                <Wrench size={14} />
                {w.action}
              </h3>
              <p>{incident.developer_action}</p>
            </div>
            <div className="action-box action-verify">
              <h3>
                <CheckCircle2 size={14} />
                {w.verify}
              </h3>
              <p>{incident.verification}</p>
            </div>
          </section>
        </div>
        <aside className="evidence-rail">
          <div className="evidence-rail-head">
            <h3>
              <Fingerprint size={16} /> {w.orig}
            </h3>
            <small>
              {w.at} · {incident.attribution_status}
            </small>
          </div>
          <div className="evidence-stream-list">
            {originals.map((ref, i) => {
              const isSel =
                selected && JSON.stringify(selected) === JSON.stringify(ref);
              return (
                <button
                  type="button"
                  key={i}
                  className="evidence-button"
                  data-selected={Boolean(isSel)}
                  onClick={() => setSelected(isSel ? null : ref)}
                >
                  <span>
                    <strong>{ref.stream}</strong>
                    <small>sha256:{ref.manifest_sha256.slice(0, 14)}…</small>
                  </span>
                  <ChevronRight
                    size={15}
                    className={isSel ? "select-chevron rotated" : "select-chevron"}
                  />
                </button>
              );
            })}
          </div>
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
