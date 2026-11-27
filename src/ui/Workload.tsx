import { useMemo, useState } from "react";
import type { CollectedWindowSection } from "../../vendor/culprit/app/src/gen/CollectedWindowSection";
import type { WindowWorkload } from "../../vendor/culprit/app/src/gen/WindowWorkload";
import type { QueryStat } from "../../vendor/culprit/app/src/gen/QueryStat";
import type { ArchiveRange } from "./navigation";
import {
  ArrowUpRight,
  GitCompareArrows,
  Search,
  TrendingUp,
  X,
} from "lucide-react";
import { WorkloadTimeline } from "./WorkloadTimeline";
import { QueryInspectorDrawer } from "./QueryInspectorDrawer";
import { humanizeGap, pct, quantity, stamp, waitTone } from "./shared";
import w from "./en.json";

type Metric =
  | "total_time_ms"
  | "cpu_time_ms"
  | "logical_reads"
  | "mean_time_ms"
  | "executions";

const metrics: Record<Metric, string> = {
  total_time_ms: w.totalTime,
  cpu_time_ms: w.cpuTime,
  logical_reads: w.logicalReads,
  mean_time_ms: w.meanTime,
  executions: w.calls,
};

function valOf(q: QueryStat, m: Metric): number {
  return q[m] ?? 0;
}

function StatementRow({
  query,
  rank,
  maximum,
  metricSum,
  metric,
  selected,
  onSelect,
}: {
  query: QueryStat;
  rank: number;
  maximum: number;
  metricSum: number;
  metric: Metric;
  selected: boolean;
  onSelect: () => void;
}) {
  const topWait = [...query.waits].sort((a, b) => b.wait_ms - a.wait_ms)[0];
  const hasMultiplePlans = Boolean(
    query.plan && query.plan_history?.captured_plan,
  );
  const val = valOf(query, metric);
  const share =
    metric !== "mean_time_ms" && metricSum > 0 ? (100 * val) / metricSum : null;

  return (
    <tr
      className={selected ? "statement-selected-row" : "statement-clickable-row"}
      onClick={onSelect}
    >
      <td>
        <button
          type="button"
          className="statement-toggle"
          aria-expanded={selected}
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
        >
          <span className="stmt-rank">#{rank}</span>
          <span className="sql-summary">
            {query.object_name || query.text || query.id}
          </span>
          <ArrowUpRight size={13} className="stmt-inspect-icon" />
        </button>
        <div className="statement-badges">
          {topWait && (
            <span className={`wait-pill wait-${waitTone(topWait.category)}`}>
              {topWait.category}
            </span>
          )}
          {hasMultiplePlans && (
            <span
              className="plan-flip-pill"
              title="Multiple execution plans captured"
            >
              <GitCompareArrows size={11} />2 plans
            </span>
          )}
        </div>
      </td>
      <td>
        <div className="query-bar-stack">
          <div className="query-bar">
            <div className="track" aria-hidden="true">
              <i
                style={{
                  width: `${maximum > 0 ? (100 * val) / maximum : 0}%`,
                }}
              />
            </div>
            <strong>{quantity(val)}</strong>
          </div>
          {share !== null && <small>{pct(share)} share</small>}
        </div>
      </td>
      <td>{quantity(query.mean_time_ms)}</td>
      <td>{quantity(query.executions)}</td>
      <td>{quantity(query.cpu_time_ms)}</td>
      <td>{quantity(query.logical_reads)}</td>
    </tr>
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
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const allQueries = section.analysis.workload?.queries ?? [];

  const totals = useMemo(
    () => ({
      totalTime: allQueries.reduce((s, q) => s + (q.total_time_ms ?? 0), 0),
      totalCpu: allQueries.reduce((s, q) => s + (q.cpu_time_ms ?? 0), 0),
      totalReads: allQueries.reduce((s, q) => s + (q.logical_reads ?? 0), 0),
    }),
    [allQueries],
  );

  const queries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...allQueries]
      .filter((item) => {
        if (!q) return true;
        return (
          (item.text?.toLowerCase().includes(q) ?? false) ||
          (item.object_name?.toLowerCase().includes(q) ?? false) ||
          item.id.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => valOf(b, metric) - valOf(a, metric));
  }, [allQueries, metric, search]);

  const metricSum = useMemo(
    () => queries.reduce((s, q) => s + valOf(q, metric), 0),
    [queries, metric],
  );

  const selectedIndex =
    selectedId !== null ? queries.findIndex((q) => q.id === selectedId) : -1;

  const changes = section.comparison.changes?.queries ?? [];
  const runtimeTotals = section.analysis.runtime_totals;

  return (
    <section className="panel workload">
      <header className="panel-head workload-head">
        <div className="panel-head-copy">
          <h2>{w.topStatements}</h2>
          <small>
            {stamp(section.observed.from)} – {stamp(section.observed.until)} ·
            Click any query to open the full-width plan &amp; wait inspector
          </small>
        </div>
        <div className="fleet-controls">
          <div className="search-box compact-search">
            <Search size={13} />
            <input
              value={search}
              placeholder="Filter SQL or object…"
              aria-label="Filter statements"
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="clear-search"
                aria-label="Clear SQL filter"
                onClick={() => setSearch("")}
              >
                <X size={12} />
              </button>
            )}
          </div>
          <div className="switcher" role="group" aria-label={w.rankBy}>
            {(Object.keys(metrics) as Metric[]).map((key) => (
              <button
                type="button"
                key={key}
                aria-pressed={metric === key}
                onClick={() => setMetric(key)}
              >
                {metrics[key]}
              </button>
            ))}
          </div>
        </div>
      </header>
      <div className="population">
        {section.population.kind === "population" && (
          <span className="pop-source-pill">
            {section.population.identity.id}
          </span>
        )}
        {runtimeTotals && (
          <span>
            <b>{Number(runtimeTotals.executions).toLocaleString()}</b>{" "}
            {w.calls.toLowerCase()} · <b>{runtimeTotals.query_identities}</b>{" "}
            {w.identities}
          </span>
        )}
        <span>
          Total CPU <b>{quantity(totals.totalCpu)} ms</b> · Logical reads{" "}
          <b>{quantity(totals.totalReads)}</b>
        </span>
        <span className="pop-scope">
          {w.sourceScope}{" "}
          <code title={section.scope_id}>{section.scope_id.slice(0, 10)}</code>
        </span>
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
                <th>{w.statement}</th>
                <th>{metrics[metric]}</th>
                <th>{w.meanTime}</th>
                <th>{w.calls}</th>
                <th>{w.cpuTime}</th>
                <th>{w.logicalReads}</th>
              </tr>
            </thead>
            <tbody>
              {queries.map((query, idx) => (
                <StatementRow
                  key={query.id}
                  query={query}
                  rank={idx + 1}
                  maximum={valOf(queries[0]!, metric)}
                  metricSum={metricSum}
                  metric={metric}
                  selected={query.id === selectedId}
                  onSelect={() =>
                    setSelectedId(query.id === selectedId ? null : query.id)
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="notice">{w.noRanked}</p>
      )}

      {selectedIndex >= 0 && (
        <QueryInspectorDrawer
          queries={queries}
          selectedIndex={selectedIndex}
          totals={totals}
          onSelectIndex={(idx) => {
            const next = queries[idx];
            if (next) setSelectedId(next.id);
          }}
          onClose={() => setSelectedId(null)}
        />
      )}

      <section className="comparison">
        <div className="comparison-head">
          <TrendingUp size={15} />
          <h3>{w.periodChanges}</h3>
        </div>
        {changes.length ? (
          <div className="period-changes-grid">
            {changes.map((change) => (
              <div key={change.query_id} className="period-change-card">
                <div className="period-change-top">
                  <strong>{change.headline}</strong>
                  <span className="count-pill pill-danger">
                    +{quantity(change.impact_ms)} ms
                  </span>
                </div>
                {change.reason && <p>{change.reason}</p>}
              </div>
            ))}
          </div>
        ) : (
          <small>{w.noComparison}</small>
        )}
        {[
          ...section.comparison.gaps.map((g) => humanizeGap(g.kind)),
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
          {humanizeGap(gap.kind)}
        </p>
      ))}
    </>
  );
}
