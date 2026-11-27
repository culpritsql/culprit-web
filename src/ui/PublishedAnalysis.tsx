import { useState } from "react";
import type { WindowPublishedAnalysis } from "../../vendor/culprit/app/src/gen/WindowPublishedAnalysis";
import type { WindowPublishedFinding } from "../../vendor/culprit/app/src/gen/WindowPublishedFinding";
import type { WindowPublishedChange } from "../../vendor/culprit/app/src/gen/WindowPublishedChange";
import type { EventKind } from "../../vendor/culprit/app/src/gen/EventKind";
import type { Category } from "../../vendor/culprit/app/src/gen/Category";
import type { DiagnosticEvidenceRef } from "../../vendor/culprit/app/src/gen/DiagnosticEvidenceRef";
import type { PublishedResourceSelector, WarehouseConnectionRef } from "./api";
import { Evidence } from "./Evidence";
import { stamp } from "./shared";
import w from "./en.json";

export type PublishedArea = "changes" | "operations" | "schema";
type Scope = {
  connection: WarehouseConnectionRef;
  resource: PublishedResourceSelector;
};
const schemaChanges = new Set<EventKind>([
  "index",
  "table",
  "statistics",
  "code",
]);
const schemaFindings = new Set<Category>(["indexes"]);
const operationalChanges = new Set<EventKind>([
  "restart",
  "throttle",
  "job-execution",
  "version",
  "native-event",
  "setting",
  "stats-reset",
]);
const operationalFindings = new Set<Category>([
  "maintenance",
  "posture",
  "configuration",
]);

function References({
  references,
  scope,
}: {
  references: DiagnosticEvidenceRef[];
  scope: Scope;
}) {
  const [selected, select] = useState<DiagnosticEvidenceRef | null>(null);
  if (!references.length) return null;
  return (
    <div>
      {references.map((ref) => (
        <button
          className="button"
          key={ref.record_id + ref.manifest_sha256}
          onClick={() => select(ref)}
        >
          {ref.stream} · {ref.record_id.slice(0, 8)}
        </button>
      ))}
      {selected && (
        <Evidence key={selected.record_id} {...scope} reference={selected} />
      )}
    </div>
  );
}
function PublishedFinding({
  item,
  scope,
}: {
  item: WindowPublishedFinding;
  scope: Scope;
}) {
  const { finding } = item.finding;
  return (
    <section className="diagnosis">
      <small>
        {finding.category} · {finding.severity}
      </small>
      <h3>{finding.title}</h3>
      <p>{finding.summary}</p>
      <small>{item.placement.qualification}</small>
      <details>
        <summary>{w.guidance}</summary>
        {item.finding.cause && <p>{item.finding.cause.summary}</p>}
        {finding.fix && (
          <>
            <h4>{w.action}</h4>
            <p>{finding.fix.summary}</p>
            {finding.fix.sql && <pre>{finding.fix.sql}</pre>}
          </>
        )}
        {finding.verify.length > 0 && (
          <>
            <h4>{w.verify}</h4>
            <ul>
              {finding.verify.map((text, i) => (
                <li key={i}>{text}</li>
              ))}
            </ul>
          </>
        )}
        {finding.caveats.map((text, i) => (
          <p key={i}>{text}</p>
        ))}
        <References references={item.finding.inputs} scope={scope} />
      </details>
    </section>
  );
}
function PublishedChange({
  item,
  scope,
}: {
  item: WindowPublishedChange;
  scope: Scope;
}) {
  const event = item.change.change;
  return (
    <section className="diagnosis">
      <small>
        {event.kind} · {stamp(event.at)} {event.job_execution?.status}
      </small>
      <h3>{event.title.text}</h3>
      {event.detail && <p>{event.detail.text}</p>}
      <small>{item.placement.qualification}</small>
      <References references={item.change.inputs} scope={scope} />
    </section>
  );
}
export function PublishedAnalysis({
  analysis,
  area,
  scope,
}: {
  analysis: WindowPublishedAnalysis;
  area: PublishedArea;
  scope: Scope;
}) {
  const findings = analysis.findings.filter(
    ({ finding }) =>
      area === "changes" ||
      (area === "schema" ? schemaFindings : operationalFindings).has(
        finding.finding.category,
      ),
  );
  const changes = analysis.changes.filter(
    ({ change }) =>
      area === "changes" ||
      (area === "schema" ? schemaChanges : operationalChanges).has(
        change.change.kind,
      ),
  );
  return (
    <article>
      <h3>
        {w.publishedAt} · {stamp(analysis.context.description.recorded_at)}
      </h3>
      {findings.map((item) => (
        <PublishedFinding
          key={item.finding.finding.id}
          item={item}
          scope={scope}
        />
      ))}
      {changes.map((item) => (
        <PublishedChange
          key={item.change.change.id}
          item={item}
          scope={scope}
        />
      ))}
      {!findings.length && !changes.length && (
        <p className="muted">{w.noMatchingFacts}</p>
      )}
      {analysis.limitations.map((reason, i) => (
        <p className="muted" key={i}>
          {reason}
        </p>
      ))}
    </article>
  );
}
