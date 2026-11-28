import { useEffect, useRef, useState } from "react";
import { ChevronDown, Clock3 } from "lucide-react";
import { shortTime, stamp } from "./shared";
import { navigate, rangeUrl, type ArchiveRange } from "./navigation";
import { w } from "./i18n";

function inputTime(iso: string) {
  return new Date(iso).toISOString().replace(/Z$/, "");
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

export function RangeSelection({ range }: { range: ArchiveRange }) {
  const [from, setFrom] = useState(() => inputTime(range.from));
  const [until, setUntil] = useState(() => inputTime(range.until));
  const [cutoff, setCutoff] = useState(() => inputTime(range.recorded_before));
  const [error, setError] = useState("");
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    setFrom(inputTime(range.from));
    setUntil(inputTime(range.until));
    setCutoff(inputTime(range.recorded_before));
  }, [range.from, range.until, range.recorded_before]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (
        detailsRef.current?.open &&
        !detailsRef.current.contains(e.target as Node)
      ) {
        detailsRef.current.open = false;
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && detailsRef.current?.open) {
        detailsRef.current.open = false;
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const spanMs = Date.parse(range.until) - Date.parse(range.from);
  const durationLabel = formatDuration(spanMs);

  const applyPreset = (minutes: number | "zoom-out") => {
    const endMs = Date.parse(range.until);
    const startMs =
      minutes === "zoom-out"
        ? Date.parse(range.from) - Math.max(spanMs, 15 * 60_000) / 2
        : endMs - minutes * 60_000;
    const nextUntil =
      minutes === "zoom-out"
        ? endMs + Math.max(spanMs, 15 * 60_000) / 2
        : endMs;
    const bounds: ArchiveRange = {
      from: new Date(startMs).toISOString(),
      until: new Date(Math.min(nextUntil, Date.parse(range.recorded_before))).toISOString(),
      recorded_before: range.recorded_before,
    };
    if (bounds.from < bounds.until) {
      if (detailsRef.current) detailsRef.current.open = false;
      navigate(rangeUrl(bounds), { preserveScroll: true });
    }
  };

  return (
    <details className="range-control" ref={detailsRef}>
      <summary>
        <Clock3 size={14} className="range-icon" />
        <span className="range-summary-text">
          {shortTime(range.from)} – {stamp(range.until)}
        </span>
        {durationLabel && (
          <span className="range-duration-pill">{durationLabel}</span>
        )}
        <ChevronDown size={13} className="select-chevron" />
      </summary>
      <form
        className="range-edit panel"
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
          setError("");
          if (detailsRef.current) detailsRef.current.open = false;
          navigate(rangeUrl(bounds), { preserveScroll: true });
        }}
      >
        <div className="range-presets">
          <span className="range-presets-label">Quick window</span>
          <div className="range-preset-chips">
            {[
              [15, "15m"],
              [60, "1h"],
              [360, "6h"],
              [1440, "24h"],
            ].map(([mins, txt]) => (
              <button
                type="button"
                key={String(txt)}
                className="chip"
                onClick={() => applyPreset(mins as number)}
              >
                {txt}
              </button>
            ))}
            <button
              type="button"
              className="chip"
              onClick={() => applyPreset("zoom-out")}
            >
              Zoom out
            </button>
          </div>
        </div>
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
        <button className="button button-accent range-submit">{w.apply}</button>
        {error && (
          <p role="alert" className="range-error">
            {error}
          </p>
        )}
      </form>
    </details>
  );
}
