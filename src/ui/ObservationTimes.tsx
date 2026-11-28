import { formatDurationMs, relativeAge, stamp } from "./shared";
import { w } from "./i18n";

export function ObservationTimes({
  first,
  last,
  recorded,
  referenceIso,
}: {
  first: string;
  last: string;
  recorded: string;
  referenceIso?: string;
}) {
  const events = [
    { label: w.first, at: first },
    { label: w.last, at: last },
    { label: w.recorded, at: recorded },
  ];
  const milliseconds = events.map((event) => Date.parse(event.at));
  const start = Math.min(...milliseconds);
  const duration = Math.max(...milliseconds) - start;
  const activeSpan = Date.parse(last) - Date.parse(first);
  const refClock = referenceIso ?? recorded;

  return (
    <figure className="timeline">
      <figcaption className="timeline-caption-row">
        <span>{w.timing}</span>
        {Number.isFinite(activeSpan) && activeSpan > 0 && (
          <span className="timeline-span-pill">
            {formatDurationMs(activeSpan)} observed window
          </span>
        )}
      </figcaption>
      {events.map((event, i) => {
        const rel = relativeAge(event.at, refClock);
        return (
          <div className="time-row" key={event.label}>
            <span className="time-row-label">{event.label}</span>
            <div className="rail" aria-hidden="true">
              {Number.isFinite(duration) && (
                <i
                  style={{
                    left:
                      (duration
                        ? ((milliseconds[i]! - start) / duration) * 100
                        : 0) + "%",
                  }}
                />
              )}
            </div>
            <div className="time-row-stamps">
              {rel && <span className="rel-age-chip">{rel}</span>}
              <time dateTime={event.at}>{stamp(event.at)}</time>
            </div>
          </div>
        );
      })}
    </figure>
  );
}
