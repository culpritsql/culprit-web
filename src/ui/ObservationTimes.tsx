import { stamp } from "./shared";
import w from "./en.json";

export function ObservationTimes({
  first,
  last,
  recorded,
}: {
  first: string;
  last: string;
  recorded: string;
}) {
  const events = [
    { label: w.first, at: first },
    { label: w.last, at: last },
    { label: w.recorded, at: recorded },
  ];
  const milliseconds = events.map((event) => Date.parse(event.at));
  const start = Math.min(...milliseconds),
    duration = Math.max(...milliseconds) - start;
  return (
    <figure className="timeline">
      <figcaption>{w.timing}</figcaption>
      {events.map((event, i) => (
        <div className="time-row" key={event.label}>
          <span>{event.label}</span>
          <div className="rail" aria-hidden="true">
            {Number.isFinite(duration) && (
              <i style={{ left: (duration ? ((milliseconds[i] - start) / duration) * 100 : 0) + "%" }} />
            )}
          </div>
          <time dateTime={event.at}>{stamp(event.at)}</time>
        </div>
      ))}
    </figure>
  );
}
