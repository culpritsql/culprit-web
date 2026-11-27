import type { QueryStat } from "../../vendor/culprit/app/src/gen/QueryStat";
import { CapturedPlan } from "./CapturedPlan";
import { quantity, stamp } from "./shared";
import w from "./en.json";

function RecordedWaits({ query }: { query: QueryStat }) {
  const sorted = [...query.waits].sort(
    (left, right) => right.wait_ms - left.wait_ms,
  );
  const coverage = query.waits_coverage;
  return (
    <section className="statement-section">
      <h3>{w.recordedWaits}</h3>
      {coverage && (
        <p>
          {w.measuredWaitClasses} {coverage.classes.join(", ") || "—"} ·{" "}
          {coverage.complete ? w.complete : w.states.partial}
        </p>
      )}
      {sorted.length ? (
        <table>
          <thead>
            <tr>
              <th>{w.waitClass}</th>
              <th>{w.waitTime}</th>
              <th>{w.waitTasks}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((wait, index) => (
              <tr key={index}>
                <td>
                  {wait.category}
                  {wait.wait_type && <small>{wait.wait_type}</small>}
                </td>
                <td>{quantity(wait.wait_ms)}</td>
                <td>{quantity(wait.tasks)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <small>{w.noRecordedWaits}</small>
      )}
    </section>
  );
}

function PlanMeasurements({ query }: { query: QueryStat }) {
  const history = query.plan_history;
  if (!query.plans.length && !history) return null;
  return (
    <section className="statement-section">
      <h3>{history?.kind === "cache" ? w.cachedPlans : w.planMeasurements}</h3>
      {history && (
        <p>
          {history.source.text} {history.note.text}
        </p>
      )}
      {query.plans.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {[
                  w.planId,
                  w.calls,
                  w.meanTime,
                  w.cpuTime,
                  w.logicalReads,
                  w.first,
                  w.last,
                ].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {query.plans.map((plan) => (
                <tr key={plan.id}>
                  <td>
                    <code>{plan.id}</code>
                  </td>
                  <td>{quantity(plan.executions)}</td>
                  <td>{quantity(plan.mean_time_ms)}</td>
                  <td>{quantity(plan.cpu_time_ms)}</td>
                  <td>{quantity(plan.logical_reads)}</td>
                  <td>{plan.first_seen ? stamp(plan.first_seen) : "—"}</td>
                  <td>{plan.last_seen ? stamp(plan.last_seen) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {history?.captured_plan && (
        <CapturedPlan
          label={
            history.captured_plan_id
              ? w.capturedPlanId + " " + history.captured_plan_id
              : w.historicalPlan
          }
          plan={history.captured_plan}
        />
      )}
    </section>
  );
}

export function StatementEvidence({ query }: { query: QueryStat }) {
  return (
    <div className="statement-detail">
      <pre>{query.text || w.noPayload}</pre>
      <small>{query.id}</small>
      {query.plan && <CapturedPlan plan={query.plan} />}
      <RecordedWaits query={query} />
      <PlanMeasurements query={query} />
    </div>
  );
}
