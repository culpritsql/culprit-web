import { AlertCircle, LoaderCircle } from "lucide-react";
import { getClockZone } from "./clock";
import { w as words } from "./i18n";

export function StateMessage({ error }: { error?: string }) {
  return (
    <div className="notice" role={error ? "alert" : "status"}>
      {error ? (
        <AlertCircle size={18} />
      ) : (
        <LoaderCircle size={18} className="spin" />
      )}{" "}
      {error ?? words.loading}
    </div>
  );
}

export function stamp(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) return value;
  if (getClockZone() === "local") {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "short",
    }).format(d);
  }
  return (
    new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZone: "UTC",
    }).format(d) + " UTC"
  );
}

export function shortTime(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) return value;
  if (getClockZone() === "local") {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZoneName: "short",
    }).format(d);
  }
  return (
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: "UTC",
    }).format(d) + " UTC"
  );
}

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) {
    return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${sec}s`;
  }
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) {
    return remSec > 0 ? `${min}m ${remSec}s` : `${min}m`;
  }
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
}

export function relativeAge(iso: string, referenceIso?: string): string {
  const target = Date.parse(iso);
  const now = referenceIso ? Date.parse(referenceIso) : Date.now();
  if (!Number.isFinite(target) || !Number.isFinite(now)) return "";
  const diffSec = Math.max(0, Math.round((now - target) / 1000));
  if (diffSec < 3) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 120) {
    const rem = diffSec % 60;
    return rem > 0 ? `1m ${rem}s ago` : "1m ago";
  }
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  const remMin = diffMin % 60;
  if (diffHr < 6 && remMin > 0) return `${diffHr}h ${remMin}m ago`;
  if (diffHr < 48) return `${Math.round(diffMin / 60)}h ago`;
  return `${Math.round(diffHr / 24)}d ago`;
}

const numberFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
});
export function quantity(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : numberFormat.format(value);
}

export function pct(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : `${Math.round(value)}%`;
}

const GAP_LABELS: Record<string, string> = {
  "original-unavailable":
    "Some original capture objects are not yet available in recovery storage.",
  "not-published":
    "One or more captures have not finished warehouse publication.",
  "acquisition-clock-boundary":
    "Captures straddling the selection cutoff were excluded.",
  "incomplete-derived-analysis":
    "A derived diagnosis capture had incomplete row coverage.",
  "more-candidates":
    "Additional resources exist beyond the current evaluation budget.",
  "no-published-originals":
    "No published original captures matched this window.",
  "no-published-analyses":
    "No published derived analyses matched this window.",
  "more-published-analyses":
    "More published analyses are available on subsequent pages.",
  "publication-discovery":
    "Warehouse publication discovery reported partial coverage.",
  "original-limit":
    "Window reached the per-action original capture ceiling.",
  "unsupported-original":
    "An original capture used an unsupported schema version.",
  "unplaced-native-clock":
    "An input capture did not carry an explicit native execution clock.",
  "raw-without-published-analysis":
    "Raw telemetry is present without a corresponding derived diagnosis.",
  "unavailable-analysis-inputs":
    "Inputs referenced by a published analysis were unavailable.",
  "incomplete-published-analysis":
    "A published analysis capture was only partially readable.",
  "no-native-intervals":
    "No native query-runtime intervals overlapped this window.",
  "unqualified-scope":
    "A capture lacked native compute-member qualification.",
  "unknown-population":
    "Runtime population membership could not be established.",
  "incomplete-original": "An original workload capture was incomplete.",
  "ambiguous-revision": "Multiple conflicting capture revisions were observed.",
  "overlapping-intervals": "Overlapping native intervals could not be merged.",
  "section-does-not-cover-window":
    "Captured workload intervals cover only part of the requested window.",
  "native-boundary-expanded":
    "Native interval bounds extend slightly beyond the requested window.",
  "conflicting-definition":
    "Conflicting SQL or plan definitions were observed across captures.",
  "capture-unavailable":
    "Referenced incident capture was unavailable in the archive.",
  "original-not-committed":
    "The referenced original capture has not been committed to object recovery.",
};

export function humanizeGap(kind: string): string {
  return (
    GAP_LABELS[kind] ??
    kind
      .replace(/-/g, " ")
      .replace(/^\w/, (ch) => ch.toUpperCase())
  );
}

export function waitTone(category: string): string {
  const c = category.toLowerCase();
  if (c.includes("cpu") || c.includes("worker")) return "cpu";
  if (c.includes("lock")) return "lock";
  if (c.includes("io") || c.includes("storage")) return "io";
  if (c.includes("log")) return "log";
  if (c.includes("latch")) return "latch";
  if (c.includes("mem") || c.includes("compil")) return "memory";
  if (c.includes("net") || c.includes("rpc")) return "network";
  return "other";
}

export function Sparkline({
  values,
  width = 84,
  height = 24,
  tone = "accent",
}: {
  values: number[];
  width?: number;
  height?: number;
  tone?: "accent" | "warn" | "danger";
}) {
  if (values.length < 2) return <span className="muted">—</span>;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 1);
  const pad = 2;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = height - pad - ((v - min) / span) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `M ${pad},${height - pad} L ${pts.join(" L ")} L ${width - pad},${height - pad} Z`;
  return (
    <svg
      className={`sparkline spark-${tone}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <path className="spark-area" d={area} />
      <polyline className="spark-line" points={pts.join(" ")} fill="none" />
    </svg>
  );
}

export function MicroMeter({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return (
      <span className="micro-meter empty">
        <small>{label}</small>
        <span>—</span>
      </span>
    );
  }
  const clamped = Math.max(0, Math.min(100, value));
  const level = clamped >= 85 ? "high" : clamped >= 65 ? "elevated" : "normal";
  return (
    <span className={`micro-meter ${level}`} title={`${label}: ${Math.round(clamped)}%`}>
      <span className="micro-meter-top">
        <small>{label}</small>
        <b>{Math.round(clamped)}%</b>
      </span>
      <span className="micro-meter-bar" aria-hidden="true">
        <i style={{ width: `${clamped}%` }} />
      </span>
    </span>
  );
}
