import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Database,
  GitCompareArrows,
  Layers,
  ListTree,
  Network,
  TableProperties,
  X,
} from "lucide-react";
import type { PlanLook } from "@culpritsql/plan-viewer";
import type { QueryStat } from "../../vendor/culprit/app/src/gen/QueryStat";
import { api, useRead } from "./api";
import { pct, quantity, stamp, waitTone } from "./shared";
import { useTheme } from "./themes";
import w from "./en.json";

const LazySql = lazy(async () => {
  const [mod] = await Promise.all([
    import("@culpritsql/plan-viewer"),
    import("@culpritsql/plan-viewer/styles.css"),
  ]);
  return { default: mod.Sql };
});

const LazyPlanViewer = lazy(async () => {
  const [mod] = await Promise.all([
    import("@culpritsql/plan-viewer"),
    import("@culpritsql/plan-viewer/styles.css"),
  ]);
  return { default: mod.PlanViewer };
});

const LazyPlanDiffViewer = lazy(async () => {
  const [mod] = await Promise.all([
    import("@culpritsql/plan-viewer"),
    import("@culpritsql/plan-viewer/styles.css"),
  ]);
  return { default: mod.PlanDiffViewer };
});

type DrawerTab = "overview" | "plan" | "diff";

const PLAN_LOOKS: Array<{
  look: PlanLook;
  label: string;
  icon: typeof Network;
}> = [
  { look: "diagram", label: "Diagram", icon: Network },
  { look: "tree", label: "Tree", icon: ListTree },
  { look: "operations", label: "Operators", icon: TableProperties },
  { look: "objects", label: "Tables", icon: Database },
];

function InlinePlanDiff({
  query,
  colorMode,
}: {
  query: QueryStat;
  colorMode: "light" | "dark";
}) {
  const planA = query.plan_history?.captured_plan ?? null;
  const planB = query.plan ?? null;
  const nameA = query.plan_history?.captured_plan_id
    ? `Baseline (${query.plan_history.captured_plan_id})`
    : "Baseline plan";
  const nameB = "Active plan";

  const load = useCallback(
    (signal: AbortSignal) => {
      if (!planA || !planB) throw new Error("Two plans required");
      return api.diffPlans(planA, planB, nameA, nameB, null, signal);
    },
    [planA, planB, nameA, nameB],
  );
  const res = useRead(load, `plan-diff:${query.id}`);

  if (!planA || !planB) return null;
  if (res.status !== "ready") {
    return (
      <p
        className="muted drawer-status-msg"
        role={res.status === "error" ? "alert" : "status"}
      >
        {res.status === "error" ? res.message : w.loading}
      </p>
    );
  }

  return (
    <Suspense
      fallback={
        <p className="muted drawer-status-msg" role="status">
          {w.loading}
        </p>
      }
    >
      <LazyPlanDiffViewer
        a={planA}
        b={planB}
        diff={res.value}
        nameA={nameA}
        nameB={nameB}
        queryB={query}
        theme={colorMode}
      />
    </Suspense>
  );
}

export function QueryInspectorDrawer({
  queries,
  selectedIndex,
  totals,
  onSelectIndex,
  onClose,
}: {
  queries: QueryStat[];
  selectedIndex: number;
  totals: { totalTime: number; totalCpu: number; totalReads: number };
  onSelectIndex: (idx: number) => void;
  onClose: () => void;
}) {
  const { colorMode } = useTheme();
  const query = queries[selectedIndex] ?? queries[0];
  const [tab, setTab] = useState<DrawerTab>("overview");
  const [planLook, setPlanLook] = useState<PlanLook>("diagram");
  const [copied, setCopied] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const hasPlan = Boolean(query?.plan);
  const canCompare = Boolean(
    query?.plan && query?.plan_history?.captured_plan,
  );

  // Lock background document scrolling cleanly with scrollbar width compensation
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    const scrollbarGap =
      window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarGap > 0) {
      document.body.style.paddingRight = `${scrollbarGap}px`;
    }
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
    };
  }, []);

  useEffect(() => {
    setTab("overview");
  }, [query?.id]);

  // Reset internal drawer scroll to top whenever tab or inspected query changes
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [query?.id, tab, planLook]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.altKey && e.key === "ArrowDown") {
        e.preventDefault();
        onSelectIndex(Math.min(queries.length - 1, selectedIndex + 1));
      } else if (e.altKey && e.key === "ArrowUp") {
        e.preventDefault();
        onSelectIndex(Math.max(0, selectedIndex - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onSelectIndex, queries.length, selectedIndex]);

  if (!query) return null;

  const sortedWaits = [...query.waits].sort((a, b) => b.wait_ms - a.wait_ms);
  const maxWait = sortedWaits[0]?.wait_ms ?? 1;
  const timeShare =
    totals.totalTime > 0 ? (100 * query.total_time_ms) / totals.totalTime : 0;
  const cpuShare =
    totals.totalCpu > 0 && query.cpu_time_ms != null
      ? (100 * query.cpu_time_ms) / totals.totalCpu
      : null;
  const readShare =
    totals.totalReads > 0 && query.logical_reads != null
      ? (100 * query.logical_reads) / totals.totalReads
      : null;

  const sqlHeadline = query.object_name
    ? query.object_name
    : query.text
      ? query.text.replace(/\s+/g, " ").trim()
      : `Query ${query.id}`;

  const isFlushCanvas = tab === "plan" || tab === "diff";

  return createPortal(
    <div
      className="drawer-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        className="query-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Statement inspector"
      >
        <header className="query-drawer-head">
          <div className="query-drawer-meta">
            <span className="drawer-rank-pill">#{selectedIndex + 1}</span>
            <strong className="drawer-sql-headline" title={sqlHeadline}>
              {sqlHeadline}
            </strong>
            {sortedWaits[0] && (
              <span
                className={`wait-pill wait-${waitTone(sortedWaits[0].category)}`}
              >
                {sortedWaits[0].category}
              </span>
            )}
            {canCompare && (
              <span className="plan-flip-pill">
                <GitCompareArrows size={11} />2 plans captured
              </span>
            )}
          </div>

          <div className="query-drawer-actions">
            <div
              className="drawer-stepper"
              role="group"
              aria-label="Step through statements"
            >
              <button
                type="button"
                className="icon-button"
                disabled={selectedIndex <= 0}
                title="Previous statement (Alt+↑)"
                aria-label="Previous statement"
                onClick={() => onSelectIndex(selectedIndex - 1)}
              >
                <ChevronUp size={15} />
              </button>
              <small>
                {selectedIndex + 1} / {queries.length}
              </small>
              <button
                type="button"
                className="icon-button"
                disabled={selectedIndex >= queries.length - 1}
                title="Next statement (Alt+↓)"
                aria-label="Next statement"
                onClick={() => onSelectIndex(selectedIndex + 1)}
              >
                <ChevronDown size={15} />
              </button>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Close statement inspector"
              onClick={onClose}
            >
              <X size={17} />
            </button>
          </div>
        </header>

        <section className="drawer-kpi-strip">
          <div>
            <small>{w.totalTime}</small>
            <strong>{quantity(query.total_time_ms)} ms</strong>
            <span className="kpi-sub">{pct(timeShare)} of window</span>
          </div>
          <div>
            <small>{w.meanTime}</small>
            <strong>{quantity(query.mean_time_ms)} ms</strong>
            <span className="kpi-sub">per execution</span>
          </div>
          <div>
            <small>{w.calls}</small>
            <strong>{quantity(query.executions)}</strong>
            <span className="kpi-sub">executions</span>
          </div>
          <div>
            <small>{w.cpuTime}</small>
            <strong>{quantity(query.cpu_time_ms)} ms</strong>
            {cpuShare !== null && (
              <span className="kpi-sub">{pct(cpuShare)} of DB CPU</span>
            )}
          </div>
          <div>
            <small>{w.logicalReads}</small>
            <strong>{quantity(query.logical_reads)}</strong>
            {readShare !== null && (
              <span className="kpi-sub">{pct(readShare)} of I/O</span>
            )}
          </div>
        </section>

        <nav className="drawer-tabs" aria-label="Inspector sections">
          <div className="drawer-tabs-primary">
            <button
              type="button"
              data-active={tab === "overview"}
              onClick={() => setTab("overview")}
            >
              <Layers size={14} />
              SQL, Waits &amp; Variants
            </button>
            {hasPlan && (
              <button
                type="button"
                data-active={tab === "plan"}
                onClick={() => setTab("plan")}
              >
                <Network size={14} />
                {w.executionPlan}
              </button>
            )}
            {canCompare && (
              <button
                type="button"
                data-active={tab === "diff"}
                onClick={() => setTab("diff")}
              >
                <GitCompareArrows size={14} />
                {w.comparePlans}
              </button>
            )}
          </div>

          {tab === "plan" && hasPlan && (
            <div
              className="drawer-plan-looks"
              role="group"
              aria-label="Execution plan view mode"
            >
              {PLAN_LOOKS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.look}
                    type="button"
                    data-active={planLook === item.look}
                    onClick={() => setPlanLook(item.look)}
                  >
                    <Icon size={12} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}
        </nav>

        <div
          ref={bodyRef}
          className={`query-drawer-body ${isFlushCanvas ? "query-drawer-body-flush" : ""}`}
        >
          {tab === "overview" && (
            <div className="drawer-overview-stack">
              <section className="drawer-sql-card">
                <div className="drawer-card-head">
                  <h3>SQL statement</h3>
                  <div className="drawer-sql-actions">
                    {canCompare && (
                      <button
                        type="button"
                        className="button button-accent"
                        onClick={() => setTab("diff")}
                      >
                        <GitCompareArrows size={14} />
                        {w.comparePlans}
                      </button>
                    )}
                    {query.text && (
                      <button
                        type="button"
                        className="chip"
                        onClick={() => {
                          navigator.clipboard?.writeText(query.text!);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1800);
                        }}
                      >
                        {copied ? <Check size={12} /> : <Copy size={12} />}
                        {copied ? "Copied" : "Copy SQL"}
                      </button>
                    )}
                  </div>
                </div>
                <div className="drawer-sql-code">
                  {query.text ? (
                    <Suspense fallback={<pre>{query.text}</pre>}>
                      <LazySql text={query.text} pretty />
                    </Suspense>
                  ) : (
                    <pre>{w.noPayload}</pre>
                  )}
                </div>
              </section>

              <div className="drawer-split-grid">
                <section className="drawer-subpanel">
                  <h3>{w.recordedWaits}</h3>
                  {sortedWaits.length > 0 ? (
                    <div className="drawer-waits-list">
                      {sortedWaits.map((wait, idx) => (
                        <div key={idx} className="drawer-wait-row">
                          <div className="drawer-wait-top">
                            <span>
                              <span
                                className={`wait-pill wait-${waitTone(wait.category)}`}
                              >
                                {wait.category}
                              </span>
                              {wait.wait_type && (
                                <code className="wait-native-code">
                                  {wait.wait_type}
                                </code>
                              )}
                            </span>
                            <strong>{quantity(wait.wait_ms)} ms</strong>
                          </div>
                          <div className="track">
                            <i
                              className={`seg-${waitTone(wait.category)}`}
                              style={{
                                width: `${Math.max(4, (100 * wait.wait_ms) / maxWait)}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <small className="muted">{w.noRecordedWaits}</small>
                  )}
                </section>

                <section className="drawer-subpanel">
                  <h3>
                    {query.plan_history?.kind === "cache"
                      ? w.cachedPlans
                      : w.planMeasurements}
                  </h3>
                  {query.plan_history && (
                    <p className="muted drawer-plan-note">
                      {query.plan_history.source.text}{" "}
                      {query.plan_history.note.text}
                    </p>
                  )}
                  {query.plans.length > 0 ? (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>{w.planId}</th>
                            <th className="num-col">{w.calls}</th>
                            <th className="num-col">{w.meanTime}</th>
                            <th className="num-col">{w.logicalReads}</th>
                            <th>{w.last}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {query.plans.map((p) => (
                            <tr key={p.id}>
                              <td>
                                <code>{p.id}</code>
                              </td>
                              <td className="num-col">
                                {quantity(p.executions)}
                              </td>
                              <td className="num-col">
                                {quantity(p.mean_time_ms)}
                              </td>
                              <td className="num-col">
                                {quantity(p.logical_reads)}
                              </td>
                              <td>{p.last_seen ? stamp(p.last_seen) : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <small className="muted">
                      Single plan variant observed in this interval.
                    </small>
                  )}
                </section>
              </div>
            </div>
          )}

          {tab === "plan" && query.plan && (
            <div className="drawer-plan-stage">
              <Suspense
                fallback={
                  <p className="muted drawer-status-msg" role="status">
                    {w.loading}
                  </p>
                }
              >
                <LazyPlanViewer
                  plan={query.plan}
                  query={query}
                  look={planLook}
                  showToolbar={false}
                  showStatement={false}
                  theme={colorMode}
                />
              </Suspense>
            </div>
          )}

          {tab === "diff" && canCompare && (
            <div className="drawer-plan-stage">
              <InlinePlanDiff query={query} colorMode={colorMode} />
            </div>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
