import { lazy, Suspense, useMemo, useState } from "react";
import {
  Activity,
  CalendarClock,
  Cpu,
  Database,
  Flame,
  GitBranch,
  HardDrive,
  Layers,
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
  const storagePoints = telemetry?.storage ?? [];
  const memoryClerkPoints = telemetry?.memory_clerks ?? [];
  const memoryGrantPoints = telemetry?.memory_grants ?? [];
  const spillPoints = telemetry?.spills ?? [];
  const jobPoints = telemetry?.jobs ?? [];

  if (
    !telemetry ||
    (!samples.length &&
      !waitSummary.length &&
      !activityPoints.length &&
      !deadlocks.length &&
      !replication.length &&
      !nodeResources.length &&
      !storagePoints.length &&
      !memoryClerkPoints.length &&
      !memoryGrantPoints.length &&
      !spillPoints.length &&
      !jobPoints.length)
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

      {storagePoints.length > 0 && (() => {
        const latestStorage = storagePoints[storagePoints.length - 1]!.report;
        const fs = latestStorage.file_summary;
        const allocBytes = fs?.data_allocated_bytes
          ? Number(fs.data_allocated_bytes)
          : null;
        const usedBytes = fs?.data_used_bytes
          ? Number(fs.data_used_bytes)
          : null;
        const logBytes = fs?.log_catalog_allocated_bytes
          ? Number(fs.log_catalog_allocated_bytes)
          : null;
        const usedPct =
          allocBytes && usedBytes && allocBytes > 0
            ? Math.min(100, (100 * usedBytes) / allocBytes)
            : null;
        const fmtGib = (b: number | null) =>
          b !== null && Number.isFinite(b)
            ? `${(b / 1024 ** 3).toFixed(1)} GiB`
            : "—";

        return (
          <section className="panel">
            <header className="panel-head">
              <div className="panel-head-copy">
                <h2 className="icon-heading">
                  <HardDrive size={18} />
                  {latestStorage.title || "Storage & file space capacity"}
                </h2>
                <small>{latestStorage.summary}</small>
              </div>
              {fs && (
                <span className="case-meta-pill">
                  {fs.data_file_count ?? 0} data · {fs.log_file_count ?? 0} log
                  files
                </span>
              )}
            </header>

            {fs && (
              <div className="ops-kpi-band">
                <div>
                  <small>Data used / allocated</small>
                  <strong>
                    {fmtGib(usedBytes)} / {fmtGib(allocBytes)}
                  </strong>
                  {usedPct !== null && (
                    <div className="ops-inline-meter">
                      <div className="track">
                        <i
                          className={usedPct >= 88 ? "seg-lock" : "seg-cpu"}
                          style={{ width: `${usedPct}%` }}
                        />
                      </div>
                      <span>{pct(usedPct)}</span>
                    </div>
                  )}
                </div>
                <div>
                  <small>Log / WAL allocated</small>
                  <strong>{fmtGib(logBytes)}</strong>
                </div>
                {fs.fields.map((f) => (
                  <div key={f.key}>
                    <small>{f.label}</small>
                    <strong>{f.value ?? "—"}</strong>
                  </div>
                ))}
              </div>
            )}

            {latestStorage.entries.length > 0 && (
              <div className="ops-cards-grid">
                {latestStorage.entries.map((entry) => (
                  <div key={entry.observation_key} className="ops-subcard">
                    <div className="ops-subcard-top">
                      <strong>{entry.title}</strong>
                      <span className="category-pill">{entry.scope}</span>
                    </div>
                    <p>{entry.explanation}</p>
                    {entry.fields.length > 0 && (
                      <div className="diag-metrics-row">
                        {entry.fields.map((f) => (
                          <span key={f.key} className="diag-metric-chip">
                            <small>{f.label}</small>
                            <b>{f.value ?? "—"}</b>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })()}

      {memoryClerkPoints.length > 0 && (() => {
        const latestClerks =
          memoryClerkPoints[memoryClerkPoints.length - 1]!.report;
        const parsedClerks = latestClerks.entries.map((entry) => {
          const primaryField = entry.fields[0];
          const rawNum = primaryField?.value ? Number(primaryField.value) : 0;
          const bytes =
            primaryField?.unit.kind === "kibibytes"
              ? rawNum * 1024
              : primaryField?.unit.kind === "bytes"
                ? rawNum
                : 0;
          const display =
            bytes >= 1024 ** 3
              ? `${(bytes / 1024 ** 3).toFixed(2)} GiB`
              : bytes >= 1024 ** 2
                ? `${(bytes / 1024 ** 2).toFixed(1)} MiB`
                : primaryField?.value ?? "—";
          return { entry, bytes, display };
        });
        const totalClerkBytes = parsedClerks.reduce((s, c) => s + c.bytes, 0);
        const tones = ["seg-cpu", "seg-memory", "seg-io", "seg-lock", "seg-network"];

        return (
          <section className="panel">
            <header className="panel-head">
              <div className="panel-head-copy">
                <h2 className="icon-heading">
                  <Layers size={18} />
                  {latestClerks.title || "Engine memory clerks"}
                </h2>
                <small>{latestClerks.summary}</small>
              </div>
              {totalClerkBytes > 0 && (
                <strong>
                  {(totalClerkBytes / 1024 ** 3).toFixed(1)} GiB tracked
                </strong>
              )}
            </header>

            {totalClerkBytes > 0 && (
              <div className="wait-proportion-bar" aria-hidden="true">
                {parsedClerks.map((c, idx) => (
                  <i
                    key={c.entry.observation_key}
                    className={tones[idx % tones.length]}
                    style={{ flex: Math.max(1, c.bytes) }}
                    title={`${c.entry.clerk_type}: ${c.display}`}
                  />
                ))}
              </div>
            )}

            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Clerk / Allocator</th>
                    <th>Subsystem</th>
                    <th>Scope</th>
                    <th>Allocation</th>
                    <th>Share</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedClerks.map(({ entry, bytes, display }) => (
                    <tr key={entry.observation_key}>
                      <td>
                        <code>{entry.clerk_type}</code>
                      </td>
                      <td>
                        <strong>{entry.name || entry.clerk_type}</strong>
                      </td>
                      <td>
                        <span className="category-pill">{entry.scope}</span>
                      </td>
                      <td>
                        <strong>{display}</strong>
                      </td>
                      <td>
                        {totalClerkBytes > 0
                          ? pct((100 * bytes) / totalClerkBytes)
                          : "—"}
                      </td>
                      <td className="ops-note-cell">{entry.explanation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })()}

      {(memoryGrantPoints.length > 0 || spillPoints.length > 0) && (
        <section className="ops-dual-grid">
          {memoryGrantPoints.length > 0 && (() => {
            const latestGrant =
              memoryGrantPoints[memoryGrantPoints.length - 1]!;
            return (
              <div className="panel">
                <header className="panel-head">
                  <div className="panel-head-copy">
                    <h2 className="icon-heading">
                      <Database size={18} />
                      {latestGrant.report.title ||
                        "Active request memory grants"}
                    </h2>
                    <small>{latestGrant.report.summary}</small>
                  </div>
                  <span className="category-pill">{latestGrant.kind}</span>
                </header>
                <div className="ops-cards-stack">
                  {latestGrant.report.entries.map((entry) => (
                    <div key={entry.observation_key} className="ops-subcard">
                      <div className="ops-subcard-top">
                        <strong>{entry.title}</strong>
                        {entry.mechanism && (
                          <span className="wait-pill wait-memory">
                            {entry.mechanism}
                          </span>
                        )}
                      </div>
                      <p>{entry.explanation}</p>
                      <details className="ops-Fold">
                        <summary>Investigation &amp; verification</summary>
                        <div className="ops-fold-body">
                          <p>
                            <b>Investigate:</b> {entry.investigation}
                          </p>
                          <p>
                            <b>Verify:</b> {entry.verify}
                          </p>
                        </div>
                      </details>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {spillPoints.length > 0 && (() => {
            const latestSpill = spillPoints[spillPoints.length - 1]!.report;
            return (
              <div className="panel">
                <header className="panel-head">
                  <div className="panel-head-copy">
                    <h2 className="icon-heading">
                      <Flame size={18} />
                      {latestSpill.title || "TempDB, sort & hash spills"}
                    </h2>
                    <small>{latestSpill.summary}</small>
                  </div>
                  <span
                    className={
                      latestSpill.entries.length > 0
                        ? "status stale"
                        : "status observed"
                    }
                  >
                    <i />
                    {latestSpill.entries.length > 0
                      ? `${latestSpill.entries.length} spilling`
                      : "0 spills"}
                  </span>
                </header>
                {latestSpill.entries.length > 0 ? (
                  <div className="ops-cards-stack">
                    {latestSpill.entries.map((entry, idx) => (
                      <div key={idx} className="ops-subcard">
                        <div className="ops-subcard-top">
                          <strong>{entry.title}</strong>
                          <span className="severity-pill sev-warn">
                            {entry.state}
                          </span>
                        </div>
                        <p>{entry.explanation}</p>
                        {entry.metrics.length > 0 && (
                          <div className="diag-metrics-row">
                            {entry.metrics.map((m, mIdx) => (
                              <span key={mIdx} className="diag-metric-chip">
                                <small>{m.label}</small>
                                <b>{m.text ?? String(m.value)}</b>
                              </span>
                            ))}
                          </div>
                        )}
                        {entry.statement_preview && (
                          <div className="diag-sql-wrap">
                            <Suspense
                              fallback={<code>{entry.statement_preview}</code>}
                            >
                              <LazySql text={entry.statement_preview} />
                            </Suspense>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="notice">
                    No sort, hash, or tempdb workspace spills recorded in this
                    window.
                  </p>
                )}
              </div>
            );
          })()}
        </section>
      )}

      {jobPoints.length > 0 && (() => {
        const latestJobs = jobPoints[jobPoints.length - 1]!.report;
        return (
          <section className="panel">
            <header className="panel-head">
              <div className="panel-head-copy">
                <h2 className="icon-heading">
                  <CalendarClock size={18} />
                  {latestJobs.title || "Scheduled & background jobs"}
                </h2>
                <small>{latestJobs.summary}</small>
              </div>
            </header>
            <div className="ops-cards-grid">
              {latestJobs.entries.map((job) => {
                const failed = job.metrics.some(
                  (m) => m.text?.toLowerCase() === "failed",
                );
                return (
                  <div
                    key={job.observation_key}
                    className={`ops-subcard ${failed ? "ops-subcard-danger" : ""}`}
                  >
                    <div className="ops-subcard-top">
                      <strong>{job.title}</strong>
                      <span
                        className={
                          failed ? "status danger" : "status observed"
                        }
                      >
                        <i />
                        {failed ? "Failed" : "Succeeded"}
                      </span>
                    </div>
                    <p>{job.explanation}</p>
                    {job.metrics.length > 0 && (
                      <div className="diag-metrics-row">
                        {job.metrics.map((m, mIdx) => (
                          <span key={mIdx} className="diag-metric-chip">
                            <small>{m.label}</small>
                            <b>{m.text ?? String(m.value)}</b>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })()}
    </div>
  );
}
