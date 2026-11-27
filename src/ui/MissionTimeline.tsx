import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Cpu,
  Layers,
  ShieldAlert,
  ZoomIn,
} from "lucide-react";
import type { WarehouseWindowReport } from "../../vendor/culprit/app/src/gen/WarehouseWindowReport";
import type { IncidentReadReport } from "../../vendor/culprit/app/src/gen/IncidentReadReport";
import { navigate, rangeUrl, spaClick, type ArchiveRange } from "./navigation";
import { pct, quantity, shortTime, stamp, waitTone } from "./shared";

function formatSpan(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

export function MissionTimeline({
  windowReport,
  incidentReport,
  range,
}: {
  windowReport: WarehouseWindowReport | null;
  incidentReport: IncidentReadReport | null;
  range: ArchiveRange;
}) {
  const uid = useId().replace(/:/g, "");
  const [collapsed, setCollapsed] = useState(false);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [dragRange, setDragRange] = useState<[number, number] | null>(null);
  const dragStartRef = useRef<number | null>(null);
  const trackWrapRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(920);

  useEffect(() => {
    const el = trackWrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const firstTrack = el.querySelector(".corr-track");
      if (firstTrack) {
        const w = Math.round(firstTrack.getBoundingClientRect().width);
        if (w > 120) setTrackWidth(w);
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [collapsed]);

  const startMs = Date.parse(range.from);
  const endMs = Date.parse(range.until);
  const spanMs = Math.max(endMs - startMs, 1);

  const resourceSeries = useMemo(() => {
    const raw =
      windowReport?.telemetry?.resources.flatMap((cap) => cap.samples) ?? [];
    return raw
      .map((s) => ({
        ms: Date.parse(s.at),
        at: s.at,
        cpu: s.cpu_pct,
        mem: s.memory_pct,
        io: s.data_io_pct,
        workers: s.workers_pct,
      }))
      .filter((s) => Number.isFinite(s.ms) && s.ms >= startMs && s.ms <= endMs)
      .sort((a, b) => a.ms - b.ms);
  }, [windowReport, startMs, endMs]);

  const waitBars = useMemo(() => {
    const intervals = windowReport?.telemetry?.wait_intervals ?? [];
    return intervals
      .map((iv) => {
        const from = Math.max(startMs, Date.parse(iv.from));
        const until = Math.min(endMs, Date.parse(iv.until));
        const segments = iv.waits
          .filter((w) => w.wait_ms > 0)
          .map((w) => ({
            category: w.category,
            tone: waitTone(w.category),
            ms: w.wait_ms,
          }));
        const total = segments.reduce((sum, w) => sum + w.ms, 0);
        const dominant = segments[0]?.category ?? "Other";
        return { from, until, total, dominant, segments };
      })
      .filter((b) => b.until > b.from && b.total > 0);
  }, [windowReport, startMs, endMs]);

  const workloadBuckets = useMemo(() => {
    const section =
      windowReport?.workload.kind === "evaluated"
        ? windowReport.workload.analysis.sections[0]
        : undefined;
    const tl = section?.analysis.workload?.timeline;
    if (!tl) return [];
    return tl.starts
      .map((start, idx) => {
        const end = tl.starts[idx + 1] ?? tl.end;
        return {
          from: Math.max(startMs, Date.parse(start)),
          until: Math.min(endMs, Date.parse(end)),
          timeMs: tl.time_ms[idx] ?? 0,
        };
      })
      .filter((b) => b.until > b.from && Number.isFinite(b.timeMs));
  }, [windowReport, startMs, endMs]);

  const events = useMemo(() => {
    const list: {
      id: string;
      kind: "incident" | "deadlock" | "change";
      from: number;
      until: number;
      label: string;
    }[] = [];
    const incidents =
      incidentReport?.incidents ?? windowReport?.incidents.incidents ?? [];
    for (const inc of incidents) {
      const f = Math.max(startMs, Date.parse(inc.entry.first_seen_at));
      const u = Math.min(endMs, Date.parse(inc.entry.last_seen_at));
      if (Number.isFinite(f) && Number.isFinite(u) && u >= f) {
        list.push({
          id: "inc:" + inc.entry.revision_id,
          kind: "incident",
          from: f,
          until: Math.max(u, f + spanMs * 0.025),
          label: inc.entry.title,
        });
      }
    }
    for (const dl of windowReport?.telemetry?.deadlocks ?? []) {
      const at = dl.at ? Date.parse(dl.at) : NaN;
      if (Number.isFinite(at) && at >= startMs && at <= endMs) {
        list.push({
          id: "dl:" + dl.id,
          kind: "deadlock",
          from: at,
          until: at,
          label: dl.headline || `Deadlock (${dl.pattern})`,
        });
      }
    }
    for (const pub of windowReport?.published ?? []) {
      for (const ch of pub.changes) {
        const at = Date.parse(ch.change.change.at);
        if (Number.isFinite(at) && at >= startMs && at <= endMs) {
          list.push({
            id: "ch:" + ch.change.change.at + ch.change.change.title.text,
            kind: "change",
            from: at,
            until: at,
            label: ch.change.change.title.text,
          });
        }
      }
    }
    return list;
  }, [incidentReport, windowReport, startMs, endMs, spanMs]);

  const hasAny =
    resourceSeries.length > 1 ||
    waitBars.length > 0 ||
    workloadBuckets.length > 0;

  if (!hasAny) return null;

  const focusMs =
    hoverRatio !== null ? startMs + hoverRatio * spanMs : null;

  const nearestRes =
    focusMs !== null && resourceSeries.length
      ? resourceSeries.reduce((best, cur) =>
          Math.abs(cur.ms - focusMs) < Math.abs(best.ms - focusMs)
            ? cur
            : best,
        )
      : resourceSeries.length
        ? resourceSeries.reduce((best, cur) =>
            (cur.cpu ?? 0) >= (best.cpu ?? 0) ? cur : best,
          )
        : undefined;

  const activeBar =
    focusMs !== null
      ? waitBars.find((b) => focusMs >= b.from && focusMs <= b.until)
      : waitBars.length
        ? waitBars.reduce((best, cur) => (cur.total > best.total ? cur : best))
        : undefined;

  const hoveredEvent =
    focusMs !== null
      ? events.find(
          (ev) =>
            focusMs >= ev.from - spanMs * 0.025 &&
            focusMs <= ev.until + spanMs * 0.025,
        )
      : undefined;

  const chartH = 56;
  const padY = 5;
  const xForMs = (ms: number) =>
    Math.max(0, Math.min(trackWidth, ((ms - startMs) / spanMs) * trackWidth));
  const yForPct = (val: number) =>
    chartH -
    padY -
    (Math.max(0, Math.min(100, val)) / 100) * (chartH - padY * 2);

  const buildCurve = (
    pick: (pt: (typeof resourceSeries)[number]) => number | null,
  ) => {
    const valid = resourceSeries.filter(
      (pt) => pick(pt) !== null && Number.isFinite(pick(pt)),
    );
    if (valid.length < 2) return null;
    const coords = valid.map((pt) => ({
      x: xForMs(pt.ms),
      y: yForPct(pick(pt)!),
    }));
    const line = coords
      .map(
        (c, idx) =>
          `${idx === 0 ? "M" : "L"} ${c.x.toFixed(1)},${c.y.toFixed(1)}`,
      )
      .join(" ");
    const area = `${line} L ${coords[coords.length - 1]!.x.toFixed(1)},${chartH} L ${coords[0]!.x.toFixed(1)},${chartH} Z`;
    return { line, area };
  };

  const cpuCurve = buildCurve((p) => p.cpu);
  const memCurve = buildCurve((p) => p.mem);
  const ioCurve = buildCurve((p) => p.io);

  const maxLoad = Math.max(
    1,
    ...waitBars.map((b) => b.total),
    ...workloadBuckets.map((b) => b.timeMs),
  );

  const gridRatios = [0, 0.25, 0.5, 0.75, 1];

  const zoomCenter = focusMs ?? startMs + spanMs / 2;
  const quarterSpan = Math.max(60_000, Math.round(spanMs * 0.25));
  const zoomHref = rangeUrl({
    from: new Date(Math.max(startMs, zoomCenter - quarterSpan)).toISOString(),
    until: new Date(Math.min(endMs, zoomCenter + quarterSpan)).toISOString(),
    recorded_before: range.recorded_before,
  });

  const ratioFromClientX = (clientX: number, container: HTMLElement) => {
    const track = container.querySelector(".corr-track");
    if (!track) return null;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const r = (clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(1, r));
  };

  return (
    <section
      className="panel corr-strip"
      aria-label="Synchronized window telemetry"
    >
      <header className="corr-head">
        <div className="corr-title">
          <Layers size={15} />
          <strong>Telemetry correlation</strong>
          <span className="corr-span-badge">{formatSpan(spanMs)}</span>
          <small>
            {shortTime(range.from)} – {shortTime(range.until)}
          </small>
        </div>

        <div className="corr-readout">
          {nearestRes && (
            <span className="mission-metrics">
              <span className="legend-dot dot-cpu">
                CPU <b>{pct(nearestRes.cpu)}</b>
              </span>
              <span className="legend-dot dot-mem">
                MEM <b>{pct(nearestRes.mem)}</b>
              </span>
              {nearestRes.io !== null && (
                <span className="legend-dot dot-io">
                  I/O <b>{pct(nearestRes.io)}</b>
                </span>
              )}
            </span>
          )}
          {activeBar && (
            <span className={`wait-pill wait-${waitTone(activeBar.dominant)}`}>
              {activeBar.dominant} · {quantity(Math.round(activeBar.total))} ms
            </span>
          )}
          {spanMs > 5 * 60_000 && (
            <a
              className="chip corr-zoom-chip"
              href={zoomHref}
              onClick={spaClick}
            >
              <ZoomIn size={12} />
              Zoom 2×
            </a>
          )}
          <button
            type="button"
            className="icon-button"
            aria-expanded={!collapsed}
            aria-label={
              collapsed ? "Expand telemetry strip" : "Collapse telemetry strip"
            }
            onClick={() => setCollapsed((v) => !v)}
          >
            {collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          </button>
        </div>
      </header>

      {!collapsed && (
        <div
          ref={trackWrapRef}
          className="corr-body"
          onPointerMove={(e) => {
            const r = ratioFromClientX(e.clientX, e.currentTarget);
            setHoverRatio(r);
            if (dragStartRef.current !== null && r !== null) {
              setDragRange([
                Math.min(dragStartRef.current, r),
                Math.max(dragStartRef.current, r),
              ]);
            }
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            const r = ratioFromClientX(e.clientX, e.currentTarget);
            if (r !== null) {
              dragStartRef.current = r;
              setDragRange(null);
            }
          }}
          onPointerUp={() => {
            if (dragRange && dragRange[1] - dragRange[0] > 0.03) {
              const f = new Date(startMs + dragRange[0] * spanMs).toISOString();
              const u = new Date(startMs + dragRange[1] * spanMs).toISOString();
              dragStartRef.current = null;
              setDragRange(null);
              navigate(
                rangeUrl({
                  from: f,
                  until: u,
                  recorded_before: range.recorded_before,
                }),
                { preserveScroll: true },
              );
              return;
            }
            dragStartRef.current = null;
            setDragRange(null);
          }}
          onPointerLeave={() => {
            setHoverRatio(null);
            dragStartRef.current = null;
            setDragRange(null);
          }}
        >
          {/* Floating non-layout-shifting hover tooltip */}
          {hoverRatio !== null && focusMs !== null && (
            <div
              className="corr-floating-tooltip panel"
              style={{
                left: `calc(140px + ${Math.min(0.76, Math.max(0.04, hoverRatio)) * 100}% * 0.84)`,
              }}
            >
              <strong>{stamp(new Date(focusMs).toISOString())}</strong>
              <div className="corr-tooltip-metrics">
                {nearestRes && (
                  <>
                    <span>CPU {pct(nearestRes.cpu)}</span>
                    <span>MEM {pct(nearestRes.mem)}</span>
                    {nearestRes.io !== null && <span>I/O {pct(nearestRes.io)}</span>}
                  </>
                )}
                {activeBar && (
                  <span>
                    {activeBar.dominant}: {quantity(Math.round(activeBar.total))} ms
                  </span>
                )}
              </div>
              {hoveredEvent && (
                <div className="corr-tooltip-event">
                  <span className={`corr-ticker-dot kind-${hoveredEvent.kind}`} />
                  <span>{hoveredEvent.label}</span>
                </div>
              )}
            </div>
          )}

          {(waitBars.length > 0 || workloadBuckets.length > 0) && (
            <div className="corr-row">
              <div className="corr-label">
                <span className="corr-label-main">
                  <Activity size={13} />
                  Load &amp; waits
                </span>
                <small>{quantity(Math.round(maxLoad))} ms pk</small>
              </div>
              <div className="corr-track corr-track-bars">
                {gridRatios.slice(1, -1).map((g) => (
                  <i
                    key={g}
                    className="corr-gridline"
                    style={{ left: `${g * 100}%` }}
                  />
                ))}
                {waitBars.length > 0
                  ? waitBars.map((bar, idx) => {
                      const left = ((bar.from - startMs) / spanMs) * 100;
                      const rawW = ((bar.until - bar.from) / spanMs) * 100;
                      const h = Math.max(10, (bar.total / maxLoad) * 92);
                      return (
                        <div
                          key={idx}
                          className="corr-bar-col"
                          style={{
                            left: `${left}%`,
                            width: `${Math.max(0.8, rawW)}%`,
                            height: `${h}%`,
                          }}
                        >
                          {bar.segments.map((seg, sIdx) => (
                            <span
                              key={sIdx}
                              className={`corr-seg seg-${seg.tone}`}
                              style={{ flex: seg.ms }}
                            />
                          ))}
                        </div>
                      );
                    })
                  : workloadBuckets.map((b, idx) => {
                      const left = ((b.from - startMs) / spanMs) * 100;
                      const rawW = ((b.until - b.from) / spanMs) * 100;
                      const h = Math.max(8, (b.timeMs / maxLoad) * 92);
                      return (
                        <div
                          key={idx}
                          className="corr-bar-col"
                          style={{
                            left: `${left}%`,
                            width: `${Math.max(0.8, rawW)}%`,
                            height: `${h}%`,
                          }}
                        >
                          <span className="corr-seg seg-cpu" style={{ flex: 1 }} />
                        </div>
                      );
                    })}
                {dragRange && (
                  <span
                    className="corr-brush"
                    style={{
                      left: `${dragRange[0] * 100}%`,
                      width: `${(dragRange[1] - dragRange[0]) * 100}%`,
                    }}
                  />
                )}
                {hoverRatio !== null && (
                  <span
                    className="corr-cursor"
                    style={{ left: `${hoverRatio * 100}%` }}
                  />
                )}
              </div>
            </div>
          )}

          {resourceSeries.length > 1 && (
            <div className="corr-row">
              <div className="corr-label">
                <span className="corr-label-main">
                  <Cpu size={13} />
                  CPU &amp; memory
                </span>
                <small>0 – 100%</small>
              </div>
              <div className="corr-track corr-track-curves">
                {gridRatios.slice(1, -1).map((g) => (
                  <i
                    key={g}
                    className="corr-gridline"
                    style={{ left: `${g * 100}%` }}
                  />
                ))}
                <svg
                  viewBox={`0 0 ${trackWidth} ${chartH}`}
                  preserveAspectRatio="none"
                  className="corr-svg"
                  aria-hidden="true"
                >
                  <defs>
                    <linearGradient
                      id={`cpuGrad-${uid}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="var(--series-cpu)"
                        stopOpacity="0.28"
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--series-cpu)"
                        stopOpacity="0.01"
                      />
                    </linearGradient>
                    <linearGradient
                      id={`memGrad-${uid}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="var(--series-mem)"
                        stopOpacity="0.2"
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--series-mem)"
                        stopOpacity="0.01"
                      />
                    </linearGradient>
                  </defs>
                  <line
                    x1="0"
                    y1={yForPct(85)}
                    x2={trackWidth}
                    y2={yForPct(85)}
                    className="lane-limit-line"
                  />
                  <line
                    x1="0"
                    y1={yForPct(50)}
                    x2={trackWidth}
                    y2={yForPct(50)}
                    className="lane-mid-line"
                  />
                  {memCurve && (
                    <>
                      <path d={memCurve.area} fill={`url(#memGrad-${uid})`} />
                      <path d={memCurve.line} fill="none" className="series-mem" />
                    </>
                  )}
                  {ioCurve && (
                    <path d={ioCurve.line} fill="none" className="series-io" />
                  )}
                  {cpuCurve && (
                    <>
                      <path d={cpuCurve.area} fill={`url(#cpuGrad-${uid})`} />
                      <path d={cpuCurve.line} fill="none" className="series-cpu" />
                    </>
                  )}
                </svg>
                {dragRange && (
                  <span
                    className="corr-brush"
                    style={{
                      left: `${dragRange[0] * 100}%`,
                      width: `${(dragRange[1] - dragRange[0]) * 100}%`,
                    }}
                  />
                )}
                {hoverRatio !== null && (
                  <span
                    className="corr-cursor"
                    style={{ left: `${hoverRatio * 100}%` }}
                  />
                )}
              </div>
            </div>
          )}

          {/* Fixed-height Events rail: NEVER mounts/unmounts on mouse move! */}
          <div className="corr-row">
            <div className="corr-label">
              <span className="corr-label-main">
                <ShieldAlert size={13} />
                Events
              </span>
              <small>{events.length} in window</small>
            </div>
            <div className="corr-track corr-track-events">
              <span className="corr-event-rail" />
              {events.map((ev) => {
                const safeLeft = 2 + ((ev.from - startMs) / spanMs) * 96;
                const safeWidth = Math.max(
                  1.4,
                  ((ev.until - ev.from) / spanMs) * 96,
                );
                return ev.kind === "incident" ? (
                  <span
                    key={ev.id}
                    className="corr-incident-span"
                    style={{
                      left: `${safeLeft}%`,
                      width: `${Math.min(98 - safeLeft, safeWidth)}%`,
                    }}
                    title={ev.label}
                  />
                ) : (
                  <span
                    key={ev.id}
                    className={`corr-event-diamond kind-${ev.kind}`}
                    style={{ left: `${safeLeft}%` }}
                    title={ev.label}
                  />
                );
              })}
              {events.length === 0 && (
                <span className="corr-no-events-label">
                  No incidents or DDL/setting changes in window
                </span>
              )}
              {hoverRatio !== null && (
                <span
                  className="corr-cursor"
                  style={{ left: `${hoverRatio * 100}%` }}
                />
              )}
            </div>
          </div>

          <div className="corr-axis-row">
            <span className="corr-axis-hint">Drag across strip to zoom</span>
            <div className="corr-axis-ticks">
              {gridRatios.map((g) => (
                <span key={g}>
                  {shortTime(new Date(startMs + g * spanMs).toISOString())}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
