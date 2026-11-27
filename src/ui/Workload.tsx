import { useId, useState } from "react";
import type { CollectedWindowSection } from "../../vendor/culprit/app/src/gen/CollectedWindowSection";
import type { WindowWorkload } from "../../vendor/culprit/app/src/gen/WindowWorkload";
import type { QueryStat } from "../../vendor/culprit/app/src/gen/QueryStat";
import type { ArchiveRange } from "./navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { WorkloadTimeline } from "./WorkloadTimeline";
import { StatementEvidence } from "./StatementEvidence";
import { stamp, quantity } from "./shared";
import w from "./en.json";

type Metric = "total_time_ms" | "mean_time_ms" | "executions";
const metrics: Record<Metric, string> = {
  total_time_ms: w.totalTime,
  mean_time_ms: w.meanTime,
  executions: w.calls,
};

function otherMetrics(selected: Metric) {
  return (Object.keys(metrics) as Metric[]).filter((key) => key !== selected);
}

function Statement({
  query,
  maximum,
  metric,
}: {
  query: QueryStat;
  maximum: number;
  metric: Metric;
}) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  return (
    <>
      <tr>
        <td>
          <button
            type="button"
            className="statement-toggle"
            aria-expanded={open}
            aria-controls={open ? detailId : undefined}
            onClick={() => setOpen(!open)}
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="sql-summary">
              {query.object_name || query.text || query.id}
            </span>
          </button>
        </td>
        <td>
          <div className="query-bar">
            <div className="track" aria-hidden="true">
              <i
                style={{
                  width:
                    (maximum > 0 ? (100 * query[metric]) / maximum : 0) + "%",
                }}
              />
            </div>
            {quantity(query[metric])}
          </div>
        </td>
        {otherMetrics(metric).map((key) => (
          <td key={key}>{quantity(query[key])}</td>
        ))}
        <td>{quantity(query.cpu_time_ms)}</td>
        <td>{quantity(query.logical_reads)}</td>
      </tr>
      {open && (
        <tr className="statement-evidence-row">
          <td id={detailId} colSpan={6}>
            <StatementEvidence query={query} />
          </td>
        </tr>
      )}
    </>
  );
}

function Population({
  section,
  range,
}: {
  section: CollectedWindowSection;
  range: ArchiveRange;
}) {
  const [metric, setMetric] = useState<Metric>("total_time_ms");
  const queries = [...(section.analysis.workload?.queries ?? [])].sort(
    (a, b) => b[metric] - a[metric],
  );
  const changes = section.comparison.changes?.queries ?? [];
  const totals = section.analysis.runtime_totals;
  return (
    <section className="panel workload">
      <header className="panel-head">
        <div>
          <h2>{w.topStatements}</h2>
          <small>
            {stamp(section.observed.from)} – {stamp(section.observed.until)}
          </small>
        </div>
        <label>
          {w.rankBy}{" "}
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as Metric)}
          >
            {(Object.keys(metrics) as Metric[]).map((key) => (
              <option key={key} value={key}>
                {metrics[key]}
              </option>
            ))}
          </select>
        </label>
      </header>
      <div className="population">
        <span>
          {w.sourceScope}{" "}
          <code title={section.scope_id}>{section.scope_id.slice(0, 12)}</code>
        </span>
        {section.population.kind === "population" && (
          <span>{section.population.identity.id}</span>
        )}
        {totals && (
          <span>
            {totals.executions} {w.calls.toLowerCase()} ·{" "}
            {totals.query_identities} {w.identities}
          </span>
        )}
      </div>
      {section.analysis.workload?.timeline && (
        <WorkloadTimeline
          timeline={section.analysis.workload.timeline}
          range={range}
        />
      )}
      {queries.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {[
                  w.statement,
                  metrics[metric],
                  ...otherMetrics(metric).map((key) => metrics[key]),
                  w.cpuTime,
                  w.logicalReads,
                ].map((label, i) => (
                  <th key={i}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {queries.map((query) => (
                <Statement
                  key={query.id}
                  query={query}
                  maximum={queries[0][metric]}
                  metric={metric}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="notice">{w.noRanked}</p>
      )}
      <section className="comparison">
        <h3>{w.periodChanges}</h3>
        {changes.length ? (
          changes.map((change) => (
            <div key={change.query_id}>
              <strong>{change.headline}</strong>{" "}
              <small>{quantity(change.impact_ms)} ms</small>
              {change.reason && <p>{change.reason}</p>}
            </div>
          ))
        ) : (
          <small>{w.noComparison}</small>
        )}
        {[
          ...section.comparison.gaps.map((g) => g.kind),
          ...section.analysis.limitations.map((l) => l.reason),
        ].map((reason, i) => (
          <p className="muted" key={i}>
            {reason}
          </p>
        ))}
      </section>
    </section>
  );
}

export function Workload({
  workload,
  range,
}: {
  workload: WindowWorkload;
  range: ArchiveRange;
}) {
  if (workload.kind !== "evaluated")
    return <p className="notice">{w.noWorkload}</p>;
  return (
    <>
      {!workload.analysis.sections.length && (
        <p className="panel notice">{w.noWorkload}</p>
      )}
      {workload.analysis.sections.map((section) => (
        <Population key={section.analysis_id} section={section} range={range} />
      ))}
      {workload.analysis.gaps.map((gap, i) => (
        <p className="muted" key={i}>
          {gap.kind}
        </p>
      ))}
    </>
  );
}
