import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Timeline } from "../../vendor/culprit/app/src/gen/Timeline";
import { rangeUrl, spaClick, type ArchiveRange } from "./navigation";
import { stamp } from "./shared";
import { w } from "./i18n";

const amount = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const utcTime = new Intl.DateTimeFormat(undefined, {
  timeZone: "UTC",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function nativeBuckets(timeline: Timeline) {
  return timeline.starts
    .map((start, index) => {
      const end = timeline.starts[index + 1] ?? timeline.end;
      const time = timeline.time_ms[index];
      const calls = timeline.executions[index];
      return {
        start,
        end,
        from: Date.parse(start),
        until: Date.parse(end),
        time,
        calls,
        unknown:
          timeline.unknown?.[index] === true ||
          !Number.isFinite(time) ||
          !Number.isFinite(calls),
      };
    })
    .filter((bucket) => bucket.until > bucket.from);
}

type Bucket = ReturnType<typeof nativeBuckets>[number];

function ChartValues({ buckets }: { buckets: Bucket[] }) {
  return (
    <details className="chart-values">
      <summary>{w.intervalValues}</summary>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {[w.from_utc, w.intervalEnd, w.totalTime, w.calls].map(
                (label) => (
                  <th key={label}>{label}</th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.start}>
                <td>{stamp(b.start)}</td>
                <td>{stamp(b.end)}</td>
                {b.unknown ? (
                  <td colSpan={2}>{w.unknownInterval}</td>
                ) : (
                  <>
                    <td>{amount.format(b.time)}</td>
                    <td>{amount.format(b.calls)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function BucketChart({ data, range }: { data: Bucket[]; range: ArchiveRange }) {
  const [selection, select] = useState({ anchor: 0, focus: 0 });
  const drag = useRef<number | null>(null);
  const first = Math.min(selection.anchor, selection.focus);
  const last = Math.max(selection.anchor, selection.focus);
  const current = data[selection.focus];
  const currentValue = current.unknown
    ? w.unknownInterval
    : amount.format(current.time / 1000) +
      " s · " +
      amount.format(current.calls) +
      " " +
      w.calls.toLowerCase();
  const from = data[0].from;
  const span = data[data.length - 1].until - from;
  const percentage = (milliseconds: number) =>
    (100 * milliseconds) / span + "%";
  const peak = data.reduce(
    (max, b) => (b.unknown ? max : Math.max(max, b.time)),
    1,
  );
  const selectedFrom = Math.max(Date.parse(range.from), data[first].from);
  const selectedUntil = Math.min(Date.parse(range.until), data[last].until);
  function point(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const position =
      from +
      Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * span;
    const index = data.findIndex((b) => b.until > position);
    return index < 0 ? data.length - 1 : index;
  }
  function move(event: KeyboardEvent<HTMLDivElement>) {
    let focus = selection.focus;
    switch (event.key) {
      case "ArrowLeft":
        focus = Math.max(0, focus - 1);
        break;
      case "ArrowRight":
        focus = Math.min(data.length - 1, focus + 1);
        break;
      case "Home":
        focus = 0;
        break;
      case "End":
        focus = data.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    select({ anchor: event.shiftKey ? selection.anchor : focus, focus });
  }
  return (
    <figure className="history-chart">
      <figcaption>{w.databaseTime}</figcaption>
      <div
        className="histogram"
        role="slider"
        tabIndex={0}
        aria-label={w.selectedTime}
        aria-valuemin={1}
        aria-valuemax={data.length}
        aria-valuenow={selection.focus + 1}
        aria-valuetext={
          stamp(data[first].start) +
          " – " +
          stamp(data[last].end) +
          ", " +
          currentValue
        }
        aria-description={w.brushHelp}
        title={w.brushHelp}
        onKeyDown={move}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          const focus = point(event);
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = event.pointerId;
          select({ anchor: focus, focus });
        }}
        onPointerMove={(event) => {
          if (drag.current !== event.pointerId) return;
          const focus = point(event);
          select((previous) => ({ ...previous, focus }));
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      >
        <i
          aria-hidden="true"
          className="brush-range"
          style={{
            left: percentage(data[first].from - from),
            width: percentage(data[last].until - data[first].from),
          }}
        />
        {data.map((b, i) => (
          <span
            key={b.start}
            aria-hidden="true"
            title={
              stamp(b.start) +
              " – " +
              stamp(b.end) +
              " · " +
              (b.unknown ? w.unknownInterval : amount.format(b.time) + " ms")
            }
            className={b.unknown ? "unmeasured" : undefined}
            data-selected={first <= i && i <= last}
            style={{
              left: percentage(b.from - from),
              width: percentage(b.until - b.from),
              height: b.unknown
                ? "100%"
                : Math.max(2, (100 * b.time) / peak) + "%",
            }}
          />
        ))}
      </div>
      <div className="axis">
        <span>{utcTime.format(from)} UTC</span>
        <span>{utcTime.format(from + span)} UTC</span>
      </div>
      <div className="bucket-detail">
        <div>
          <strong>
            {stamp(data[first].start)} – {utcTime.format(data[last].until)} UTC
          </strong>
          {first === last && <small>{currentValue}</small>}
        </div>
        {selectedFrom < selectedUntil && (
          <a
            className="button button-accent"
            href={rangeUrl({
              from: new Date(selectedFrom).toISOString(),
              until: new Date(selectedUntil).toISOString(),
              recorded_before: range.recorded_before,
            })}
            onClick={spaClick}
          >
            {w.inspectInterval}
          </a>
        )}
      </div>
      <ChartValues buckets={data} />
    </figure>
  );
}

export function WorkloadTimeline({
  timeline,
  range,
}: {
  timeline: Timeline;
  range: ArchiveRange;
}) {
  const data = nativeBuckets(timeline);
  return data.length ? (
    <BucketChart
      key={data[0].start + "/" + data[data.length - 1].end + "/" + data.length}
      data={data}
      range={range}
    />
  ) : null;
}
