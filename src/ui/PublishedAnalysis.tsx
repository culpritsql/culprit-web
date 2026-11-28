import { lazy, Suspense, useState } from "react";
import {
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  Fingerprint,
  GitCommitHorizontal,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import type { WindowPublishedAnalysis } from "../../vendor/culprit/app/src/gen/WindowPublishedAnalysis";
import type { WindowPublishedFinding } from "../../vendor/culprit/app/src/gen/WindowPublishedFinding";
import type { WindowPublishedChange } from "../../vendor/culprit/app/src/gen/WindowPublishedChange";
import type { EventKind } from "../../vendor/culprit/app/src/gen/EventKind";
import type { Category } from "../../vendor/culprit/app/src/gen/Category";
import type { DiagnosticEvidenceRef } from "../../vendor/culprit/app/src/gen/DiagnosticEvidenceRef";
import type { PublishedResourceSelector, WarehouseConnectionRef } from "./api";
import { Evidence } from "./Evidence";
import { pct, quantity, stamp } from "./shared";
import { w } from "./i18n";

const LazySql = lazy(async () => {
  const [mod] = await Promise.all([
    import("@culpritsql/plan-viewer"),
    import("@culpritsql/plan-viewer/styles.css"),
  ]);
  return { default: mod.Sql };
});

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

function severityTone(sev: string): "danger" | "warn" | "neutral" {
  if (sev === "high" || sev === "critical") return "danger";
  if (sev === "medium") return "warn";
  return "neutral";
}

function CopySqlButton({ sql }: { sql: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="chip copy-sql-btn"
      onClick={() => {
        navigator.clipboard?.writeText(sql);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? "Copied" : "Copy SQL"}
    </button>
  );
}

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
    <div className="diag-refs">
      <div className="diag-ref-buttons">
        {references.map((ref) => {
          const active = selected?.record_id === ref.record_id;
          return (
            <button
              type="button"
              className="chip"
              data-active={active}
              key={ref.record_id + ref.manifest_sha256}
              onClick={() => select(active ? null : ref)}
            >
              <Fingerprint size={12} />
              {ref.stream} · {ref.record_id.slice(0, 8)}
            </button>
          );
        })}
      </div>
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
  const tone = severityTone(finding.severity);
  const metrics = finding.metrics ?? [];
  const qual = item.placement.qualification;
  const showQual =
    qual && qual !== "Original native clock unavailable" ? qual : null;

  return (
    <article className={`diag-card diag-${tone}`}>
      <div className="diag-card-top">
        <div className="diag-badges">
          <span className={`severity-pill sev-${tone}`}>
            {(finding.severity ?? "info").toUpperCase()}
          </span>
          {finding.category && (
            <span className="category-pill">{finding.category}</span>
          )}
          {finding.confidence && (
            <span className="case-meta-pill">
              {finding.confidence} confidence
            </span>
          )}
        </div>
        {showQual && <small className="diag-qual">{showQual}</small>}
      </div>

      <h3>{finding.title}</h3>
      <p className="diag-summary">{finding.summary}</p>

      {metrics.length > 0 && (
        <div className="diag-metrics-row">
          {metrics.slice(0, 5).map((m, idx) => (
            <span key={idx} className="diag-metric-chip">
              <small>{m.label}</small>
              <b>
                {m.text ??
                  (m.unit === "ratio" ? pct(m.value * 100) : quantity(m.value))}
              </b>
            </span>
          ))}
        </div>
      )}

      <details
        className="diag-guidance"
        open={finding.severity === "high"}
      >
        <summary>
          <Sparkles size={13} />
          <span>{w.guidance}</span>
        </summary>
        <div className="diag-guidance-body">
          {item.finding.cause && (
            <p className="diag-cause">{item.finding.cause.summary}</p>
          )}
          {finding.fix && (
            <div className="diag-fix-box">
              <div className="diag-fix-head">
                <h4>
                  <Wrench size={13} />
                  {w.action}
                </h4>
                {finding.fix.sql && <CopySqlButton sql={finding.fix.sql} />}
              </div>
              <p>{finding.fix.summary}</p>
              {finding.fix.sql && (
                <div className="diag-sql-wrap">
                  <Suspense fallback={<pre>{finding.fix.sql}</pre>}>
                    <LazySql text={finding.fix.sql} pretty />
                  </Suspense>
                </div>
              )}
            </div>
          )}
          {finding.verify.length > 0 && (
            <div className="diag-verify-box">
              <h4>
                <CheckCircle2 size={13} />
                {w.verify}
              </h4>
              <ul className="diag-verify-list">
                {finding.verify.map((text, i) => (
                  <li key={i}>{text}</li>
                ))}
              </ul>
            </div>
          )}
          {finding.caveats.map((text, i) => (
            <p key={i} className="muted diag-caveat">
              {text}
            </p>
          ))}
          <References references={item.finding.inputs} scope={scope} />
        </div>
      </details>
    </article>
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
  const qual = item.placement.qualification;
  const showQual =
    qual && qual !== "Original native clock unavailable" ? qual : null;

  return (
    <article className="change-event-card">
      <div className="change-event-icon">
        <GitCommitHorizontal size={16} />
      </div>
      <div className="change-event-content">
        <div className="diag-badges">
          <span className="category-pill">{event.kind}</span>
          <span className="change-time">
            <Clock3 size={12} />
            {stamp(event.at)}
          </span>
          {event.object && <code className="sha-pill">{event.object}</code>}
          {event.job_execution?.status && (
            <span
              className={`status ${
                event.job_execution.status === "failed" ? "danger" : "observed"
              }`}
            >
              <i />
              {event.job_execution.status}
            </span>
          )}
        </div>
        <h3>{event.title.text}</h3>
        {event.detail && <p>{event.detail.text}</p>}
        {showQual && <small className="muted">{showQual}</small>}
        <References references={item.change.inputs} scope={scope} />
      </div>
    </article>
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
  const checks = analysis.context.description.finding_evaluations.checks;
  const cleanLimitations = analysis.limitations.filter(
    (r) => r !== "Original schema context unavailable",
  );

  return (
    <div className="analysis-snapshot-block">
      <div className="analysis-snapshot-bar">
        <span>
          <ShieldCheck size={14} />
          <strong>{w.publishedAt}</strong> ·{" "}
          {stamp(analysis.context.description.recorded_at)}
        </span>
        {analysis.context.description.rules_version &&
          analysis.context.description.rules_version !==
            "presentation-only" && (
            <span className="case-meta-pill">
              Rules {analysis.context.description.rules_version}
            </span>
          )}
      </div>

      {findings.length > 0 && (
        <div className="diag-list">
          {findings.map((item) => (
            <PublishedFinding
              key={item.finding.finding.id}
              item={item}
              scope={scope}
            />
          ))}
        </div>
      )}

      {changes.length > 0 && (
        <div className="change-event-list">
          {changes.map((item) => (
            <PublishedChange
              key={item.change.change.id}
              item={item}
              scope={scope}
            />
          ))}
        </div>
      )}

      {!findings.length && !changes.length && (
        <div className="empty-state-box">
          <p className="muted">{w.noMatchingFacts}</p>
        </div>
      )}

      {checks.length > 0 && (
        <details className="verified-checks-details">
          <summary>
            <CheckCircle2 size={14} />
            <span>
              Evaluated diagnostic checks ({checks.length} checks verified)
            </span>
          </summary>
          <div className="verified-checks-grid">
            {checks.map((chk) => (
              <div key={chk.check} className="verified-check-chip">
                <i
                  className={`check-dot dot-${
                    chk.status === "assessed" || chk.status === "findings"
                      ? "healthy"
                      : "degraded"
                  }`}
                />
                <span>{chk.check.replace(/_/g, " ")}</span>
                <small>{chk.status}</small>
              </div>
            ))}
          </div>
        </details>
      )}

      {cleanLimitations.map((reason, i) => (
        <p className="muted" key={i}>
          {reason}
        </p>
      ))}
    </div>
  );
}
