import { lazy, Suspense, useMemo, useState } from "react";
import {
  Activity,
  Cpu,
  GitBranch,
  HardDrive,
  Lock,
  Network,
  Server,
  ShieldAlert,
} from "lucide-react";
import type { WarehouseWindowReport } from "../../vendor/culprit/app/src/gen/WarehouseWindowReport";
import type { BlockNode } from "../../vendor/culprit/app/src/gen/BlockNode";
import { pct, quantity, shortTime, stamp, waitTone } from "./shared";
import { useTheme } from "./themes";
import w from "./en.json";

const LazyDeadlockViewer = lazy(async () => {
  const [mod] = await Promise.all([
    import("@culpritsql/plan-viewer"),
    import("@culpritsql/plan-viewer/styles.css"),
  ]);
  return { default: mod.DeadlockViewer };
});

const LazySql = lazy(async () => {
  const [mod] = await Promise.all([
    import("@culpritsql/plan-viewer"),
    import("@culpritsql/plan-viewer/styles.css"),
  ]);
  return { default: mod.Sql };
});

function BlockingNodeTree({
  node,
  depth = 0,
}: {
  node: BlockNode;
  depth?: number;
}) {
  const ctx = node.context;
  return (
    <div className="block-tree-node" style={{ marginLeft: depth * 18 }}>
      <div className={`block-card ${depth === 0 ? "block-head" : "block-waiter"}`}>
        <div className="block-card-top">
          <span className="session-pill">
            {depth === 0 ? "HEAD BLOCKER" : "BLOCKED"} · Session {node.session}
          </span>
          {ctx?.state && <span className="status">{ctx.state}</span>}
          {ctx?.wait && (
            <span className="wait-pill wait-lock">
              {ctx.wait}
              {ctx.wait_ms != null && ` · ${quantity(ctx.wait_ms)} ms`}
            </span>
          )}
          {ctx?.transaction_ms != null && (
            <small>Tx open {quantity(ctx.transaction_ms)} ms</small>
          )}
        </div>
        <div className="block-meta">
          {ctx?.application && <span>App: {ctx.application}</span>}
          {ctx?.user && <span>User: {ctx.user}</span>}
          {node.waits_for && <span>Waiting for: {node.waits_for}</span>}
        </div>
        {ctx?.sql && (
          <div className="block-sql">
            <Suspense fallback={<code>{ctx.sql}</code>}>
              <LazySql text={ctx.sql} />
            </Suspense>
          </div>
        )}
      </div>
      {node.children.map((child) => (
        <BlockingNodeTree key={child.key} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

export function ResourcesView({ data }: { data: WarehouseWindowReport }) {
  const { colorMode } = useTheme();
  const [selectedDeadlock, setSelectedDeadlock] = useState(0);
  const telemetry = data.telemetry;

  const samples = useMemo(
    () =>
      (telemetry?.resources.flatMap((r) => r.samples) ?? []).sort((a, b) =>
        a.at.localeCompare(b.at),
      ),
    [telemetry],
  );

  const waitSummary = useMemo(() => {
    const map = new Map<
      string,
      {
        category: string;
        waitMs: number;
        signalMs: number;
        tasks: number;
        topTypes: Set<string>;
      }
    >();
    for (const iv of telemetry?.wait_intervals ?? []) {
      for (const item of iv.waits) {
        const entry = map.get(item.category) ?? {
          category: item.category,
          waitMs: 0,
          signalMs: 0,
          tasks: 0,
          topTypes: new Set<string>(),
        };
        entry.waitMs += item.wait_ms;
        entry.signalMs += item.signal_wait_ms;
        entry.tasks += item.waiting_tasks;
        if (item.wait_type && entry.topTypes.size < 3)
          entry.topTypes.add(item.wait_type);
        map.set(item.category, entry);
      }
    }
    return [...map.values()].sort((a, b) => b.waitMs - a.waitMs);
  }, [telemetry]);

  const totalWaitMs = waitSummary.reduce((s, x) => s + x.waitMs, 0);

  const statSummary = (
    pick: (s: (typeof samples)[number]) => number | null,
  ) => {
    const vals = samples
      .map(pick)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    if (!vals.length) return null;
    const peak = Math.max(...vals);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const latest = vals[vals.length - 1];
    return { peak, avg, latest, values: vals };
  };

  const cpuStats = statSummary((s) => s.cpu_pct);
  const memStats = statSummary((s) => s.memory_pct);
  const ioStats = statSummary((s) => s.data_io_pct);
  const logStats = statSummary((s) => s.log_write_pct);
  const workerStats = statSummary((s) => s.workers_pct);

  const activityPoints = telemetry?.activity ?? [];
  const blockingReports = activityPoints
    .map((pt) => pt.blocking)
    .filter((b): b is NonNullable<typeof b> => Boolean(b));
  const deadlocks = telemetry?.deadlocks ?? [];
  const replication = telemetry?.replication ?? [];
  const nodeResources = telemetry?.node_resources ?? [];

  if (
    !telemetry ||
    (!samples.length &&
      !waitSummary.length &&
      !activityPoints.length &&
      !deadlocks.length &&
      !replication.length &&
      !nodeResources.length)
  ) {
    return (
      <section className="panel notice">
        <Cpu size={18} />
        {w.noTelemetry}
      </section>
    );
  }

  const metricCards = [
    { key: "cpu", title: "CPU utilization", stats: cpuStats, cls: "series-cpu", icon: Cpu },
    { key: "mem", title: "Memory utilization", stats: memStats, cls: "series-mem", icon: Server },
    { key: "io", title: "Data I/O", stats: ioStats, cls: "series-io", icon: HardDrive },
    { key: "log", title: "Log write throughput", stats: logStats, cls: "series-log", icon: GitBranch },
    { key: "workers", title: "Worker threads", stats: workerStats, cls: "series-workers", icon: Activity },
  ].filter((c) => c.stats !== null);

  return (
    <div className="resources-stack">
      {metricCards.length > 0 && (
        <section className="resource-cards-grid">
          {metricCards.map((card) => {
            const st = card.stats!;
            const Icon = card.icon;
            const pts = st.values
              .map((v, i) => {
                const x =
                  st.values.length > 1
                    ? (i / (st.values.length - 1)) * 300
                    : 150;
                const y = 76 - (Math.max(0, Math.min(100, v)) / 100) * 68;
                return `${x.toFixed(1)},${y.toFixed(1)}`;
              })
              .join(" ");
            const area = `M 0,76 L ${pts.replace(/ /g, " L ")} L 300,76 Z`;
            return (
              <article key={card.key} className="panel resource-chart-card">
                <header>
                  <span className="resource-card-title">
                    <Icon size={15} />
                    {card.title}
                  </span>
                  <strong className={st.peak >= 85 ? "text-danger" : ""}>
                    {pct(st.latest)}
                  </strong>
                </header>
                <div className="resource-stat-row">
                  <span>Avg {pct(st.avg)}</span>
                  <span>Peak {pct(st.peak)}</span>
                  {samples.length > 1 && (
                    <span>
                      {shortTime(samples[0].at)} –{" "}
                      {shortTime(samples[samples.length - 1].at)}
                    </span>
                  )}
                </div>
                <svg
                  viewBox="0 0 300 80"
                  preserveAspectRatio="none"
                  className={`resource-area-svg ${card.cls}`}
                  aria-hidden="true"
                >
                  <line x1="0" y1="8" x2="300" y2="8" className="lane-limit-line" />
                  <line x1="0" y1="42" x2="300" y2="42" className="lane-mid-line" />
                  <path d={area} className="area-fill" />
                  <polyline points={pts} fill="none" className="area-stroke" />
                </svg>
              </article>
            );
          })}
        </section>
      )}

      {nodeResources.length > 0 && (
        <section className="panel">
          <header className="panel-head">
            <div className="panel-head-copy">
              <h2>Host &amp; cluster node capacity</h2>
              <small>
                Physical / VM memory and CPU utilization captured with operational telemetry
              </small>
            </div>
          </header>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Node</th>
                  <th>Status</th>
                  <th>Host RAM</th>
                  <th>Available RAM</th>
                  <th>User CPU</th>
                  <th>System CPU</th>
                </tr>
              </thead>
              <tbody>
                {nodeResources.flatMap((nr) =>
                  nr.nodes.map((node, idx) => (
                    <tr key={node.node + idx}>
                      <td>
                        <strong>{node.node}</strong>
                      </td>
                      <td>
                        <span className={node.available ? "status observed" : "status stale"}>
                          <i />
                          {node.available ? "Online" : "Unavailable"}
                        </span>
                      </td>
                      <td>
                        {node.host_memory_total_bytes != null
                          ? `${(node.host_memory_total_bytes / 1024 ** 3).toFixed(1)} GiB`
                          : "—"}
                      </td>
                      <td>
                        {node.host_memory_available_bytes != null
                          ? `${(node.host_memory_available_bytes / 1024 ** 3).toFixed(1)} GiB`
                          : "—"}
                      </td>
                      <td>
                        {node.cpu_user_fraction != null
                          ? pct(node.cpu_user_fraction * 100)
                          : "—"}
                      </td>
                      <td>
                        {node.cpu_system_fraction != null
                          ? pct(node.cpu_system_fraction * 100)
                          : "—"}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {waitSummary.length > 0 && (
        <section className="panel">
          <header className="panel-head">
            <div className="panel-head-copy">
              <h2>Wait class breakdown</h2>
              <small>
                Verified cumulative counter deltas across{" "}
                {telemetry.wait_intervals.length} native intervals
              </small>
            </div>
            <strong>{quantity(totalWaitMs)} ms total wait</strong>
          </header>
          <div className="wait-proportion-bar" aria-hidden="true">
            {waitSummary.map((item) => (
              <i
                key={item.category}
                className={`wait-bg-${waitTone(item.category)}`}
                style={{ flex: Math.max(item.waitMs, 1) }}
                title={`${item.category}: ${quantity(item.waitMs)} ms`}
              />
            ))}
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Wait class</th>
                  <th>Share</th>
                  <th>Total wait (ms)</th>
                  <th>Signal / CPU queue (ms)</th>
                  <th>Waiting tasks</th>
                  <th>Top native waits</th>
                </tr>
              </thead>
              <tbody>
                {waitSummary.map((item) => {
                  const share =
                    totalWaitMs > 0 ? (100 * item.waitMs) / totalWaitMs : 0;
                  return (
                    <tr key={item.category}>
                      <td>
                        <span
                          className={`wait-pill wait-${waitTone(item.category)}`}
                        >
                          {item.category}
                        </span>
                      </td>
                      <td>{pct(share)}</td>
                      <td>{quantity(item.waitMs)}</td>
                      <td>{quantity(item.signalMs)}</td>
                      <td>{quantity(item.tasks)}</td>
                      <td>
                        <code>{[...item.topTypes].join(", ") || "—"}</code>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activityPoints.length > 0 && (
        <section className="panel">
          <header className="panel-head">
            <div className="panel-head-copy">
              <h2 className="icon-heading">
                <Lock size={18} />
                Session concurrency &amp; blocking chains
              </h2>
              <small>
                Active, blocked and idle-in-transaction session observations
              </small>
            </div>
          </header>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Observed at</th>
                  <th>Active</th>
                  <th>Blocked</th>
                  <th>Waiting on lock</th>
                  <th>Idle in tx</th>
                  <th>Longest wait</th>
                  <th>Oldest tx</th>
                </tr>
              </thead>
              <tbody>
                {activityPoints.map((pt, i) => (
                  <tr key={i}>
                    <td>
                      {pt.native_clock.kind === "unknown"
                        ? "—"
                        : stamp(pt.native_clock.from)}
                    </td>
                    <td>{pt.active_sessions}</td>
                    <td>
                      {pt.blocked_sessions > 0 ? (
                        <span className="count-pill pill-danger">
                          {pt.blocked_sessions}
                        </span>
                      ) : (
                        0
                      )}
                    </td>
                    <td>{pt.waiting_on_lock_sessions}</td>
                    <td>
                      {pt.idle_in_transaction_sessions > 0 ? (
                        <span className="count-pill pill-warn">
                          {pt.idle_in_transaction_sessions}
                        </span>
                      ) : (
                        0
                      )}
                    </td>
                    <td>
                      {pt.max_wait_ms != null
                        ? `${quantity(Number(pt.max_wait_ms))} ms`
                        : "—"}
                    </td>
                    <td>
                      {pt.max_transaction_age_ms != null
                        ? `${quantity(Number(pt.max_transaction_age_ms))} ms`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {blockingReports.map((rep, idx) => (
            <div key={idx} className="blocking-section">
              <div className="blocking-summary">
                <strong>{rep.title}</strong>
                <p>{rep.summary}</p>
              </div>
              {rep.blocking?.chains.map((chain, cIdx) => (
                <div key={cIdx} className="blocking-chain-wrap">
                  <div className="chain-banner">
                    <span>
                      {chain.headline ||
                        `${chain.waiters} blocked session${chain.waiters === 1 ? "" : "s"}`}
                      {chain.longest_wait_ms != null &&
                        ` · Longest wait ${quantity(chain.longest_wait_ms)} ms`}
                    </span>
                    <small>Head: {chain.head_kind}</small>
                  </div>
                  {chain.advice && <p className="muted">{chain.advice}</p>}
                  <BlockingNodeTree node={chain.tree} />
                </div>
              ))}
            </div>
          ))}
        </section>
      )}

      {deadlocks.length > 0 && (
        <section className="panel case">
          <header className="panel-head">
            <div className="panel-head-copy">
              <h2 className="icon-heading">
                <ShieldAlert size={18} />
                Captured deadlock graphs ({deadlocks.length})
              </h2>
              <small>
                Interactive lock-cycle graph and victim resolution
              </small>
            </div>
            {deadlocks.length > 1 && (
              <div className="switcher">
                {deadlocks.map((dl, idx) => (
                  <button
                    type="button"
                    key={dl.id}
                    aria-pressed={selectedDeadlock === idx}
                    onClick={() => setSelectedDeadlock(idx)}
                  >
                    #{idx + 1} · {dl.at ? shortTime(dl.at) : dl.pattern}
                  </button>
                ))}
              </div>
            )}
          </header>
          <Suspense fallback={<p role="status">{w.loading}</p>}>
            <LazyDeadlockViewer
              deadlock={deadlocks[selectedDeadlock] ?? deadlocks[0]}
              theme={colorMode}
            />
          </Suspense>
        </section>
      )}

      {replication.length > 0 && (
        <section className="panel">
          <header className="panel-head">
            <div className="panel-head-copy">
              <h2 className="icon-heading">
                <Network size={18} />
                Replication &amp; HA health
              </h2>
              <small>{replication[replication.length - 1].report.summary}</small>
            </div>
          </header>
          <div className="replication-entries">
            {replication[replication.length - 1].report.entries.map(
              (entry, idx) => (
                <div key={idx} className="diagnosis">
                  <div className="case-title">
                    <strong>{entry.title}</strong>
                    <span
                      className={
                        entry.conditions.length > 0
                          ? "status stale"
                          : "status observed"
                      }
                    >
                      <i />
                      {entry.conditions.length > 0
                        ? entry.conditions.join(", ")
                        : "Healthy"}
                    </span>
                  </div>
                  <p>{entry.explanation}</p>
                  <div className="population">
                    {entry.fields.map((m, mIdx) => (
                      <span key={mIdx}>
                        {m.label}: <b>{m.value ?? "—"}</b>
                      </span>
                    ))}
                  </div>
                </div>
              ),
            )}
          </div>
        </section>
      )}
    </div>
  );
}
