import { useState } from "react";
import type { Timeline } from "../../vendor/culprit/app/src/gen/Timeline";
import { stamp } from "./shared";
import w from "./en.json";

const amount = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
function clock(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}
function buckets(timeline: Timeline) {
  return timeline.starts
    .map((start, i) => ({
      start,
      end: timeline.starts[i + 1] ?? timeline.end,
      time: timeline.time_ms[i],
      calls: timeline.executions[i],
      partial: timeline.unknown?.[i] === true,
    }))
    .filter(
      (b) =>
        Number.isFinite(b.time) &&
        Number.isFinite(b.calls) &&
        Date.parse(b.end) > Date.parse(b.start),
    );
}
export function WorkloadTimeline({ timeline }: { timeline: Timeline }) {
  const data = buckets(timeline);
  const [index, setIndex] = useState(0);
  const chosen = data[index];
  if (!chosen) return null;
  const start = Date.parse(data[0].start);
  const length = Date.parse(data.at(-1)!.end) - start;
  const max = Math.max(1, ...data.map((b) => b.time));
  return (
    <figure className="history-chart">
      <figcaption>{w.databaseTime}</figcaption>
      <div className="histogram" aria-hidden="true">
        {data.map((b, i) => (
          <span
            key={b.start}
            className={b.partial ? "bounded" : ""}
            data-selected={i === index}
            onPointerEnter={() => setIndex(i)}
            style={{
              left: ((Date.parse(b.start) - start) / length) * 100 + "%",
              width:
                ((Date.parse(b.end) - Date.parse(b.start)) / length) * 100 +
                "%",
              height: Math.max(1, (100 * b.time) / max) + "%",
            }}
          />
        ))}
      </div>
      <div className="axis">
        <span>{clock(data[0].start)} UTC</span>
        <span>{clock(data.at(-1)!.end)} UTC</span>
      </div>
      <div className="bucket-detail">
        <label>
          {w.interval}{" "}
          <select
            value={index}
            onChange={(e) => setIndex(Number(e.target.value))}
          >
            {data.map((b, i) => (
              <option key={b.start} value={i}>
                {stamp(b.start)} – {clock(b.end)} UTC
              </option>
            ))}
          </select>
        </label>
        <span>
          {chosen.partial ? "≥ " : ""}
          {amount.format(chosen.time / 1000)} s · {chosen.partial ? "≥ " : ""}
          {amount.format(chosen.calls)} {w.calls.toLowerCase()}
          {chosen.partial ? " · " + w.lowerBound : ""}
        </span>
      </div>
    </figure>
  );
}
