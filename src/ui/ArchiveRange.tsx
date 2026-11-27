import { useState } from "react";
import { Clock3 } from "lucide-react";
import { stamp } from "./shared";
import { putRange, type ArchiveRange } from "./navigation";
import w from "./en.json";

function inputTime(iso: string) {
  return new Date(iso).toISOString().replace(/Z$/, "");
}
export function RangeSelection({ range }: { range: ArchiveRange }) {
  const [from, setFrom] = useState(() => inputTime(range.from));
  const [until, setUntil] = useState(() => inputTime(range.until));
  const [cutoff, setCutoff] = useState(() => inputTime(range.recorded_before));
  const [error, setError] = useState("");
  return (
    <details className="range-control">
      <summary>
        <Clock3 size={15} />
        <span>
          {stamp(range.from)} – {stamp(range.until)}
        </span>
      </summary>
      <form
        className="range-edit"
        onSubmit={(event) => {
          event.preventDefault();
          const bounds = {
            from: new Date(from + "Z").toISOString(),
            until: new Date(until + "Z").toISOString(),
            recorded_before: new Date(cutoff + "Z").toISOString(),
          };
          if (bounds.from >= bounds.until) {
            setError(w.invalidRange);
            return;
          }
          const url = new URL(location.href);
          url.searchParams.delete("incident");
          putRange(url.searchParams, bounds);
          url.searchParams.set(
            "around",
            new Date(
              (Date.parse(bounds.from) + Date.parse(bounds.until)) / 2,
            ).toISOString(),
          );
          location.assign(url);
        }}
      >
        <label>
          {w.from_utc}
          <input
            type="datetime-local"
            step="any"
            value={from}
            required
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          {w.until}
          <input
            type="datetime-local"
            step="any"
            value={until}
            required
            onChange={(e) => setUntil(e.target.value)}
          />
        </label>
        <label>
          {w.cutoff}
          <input
            type="datetime-local"
            step="any"
            value={cutoff}
            required
            onChange={(e) => setCutoff(e.target.value)}
          />
        </label>
        <button className="button">{w.apply}</button>
        {error && <p role="alert">{error}</p>}
      </form>
    </details>
  );
}
