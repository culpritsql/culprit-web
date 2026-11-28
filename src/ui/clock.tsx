import { useSyncExternalStore } from "react";
import { Clock3 } from "lucide-react";
import { useLocale, w } from "./i18n";

export type ClockZone = "utc" | "local";

const STORAGE_KEY = "culprit-fleet-clock";
const listeners = new Set<() => void>();

function readInitialClock(): ClockZone {
  if (typeof window === "undefined") return "utc";
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "local" || saved === "utc") return saved;
  } catch {
    /* Ignore storage access errors. */
  }
  return "utc";
}

let currentZone: ClockZone = readInitialClock();

export function getClockZone(): ClockZone {
  return currentZone;
}

export function setClockZone(next: ClockZone) {
  if (next === currentZone) return;
  currentZone = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* Ignore storage access errors. */
  }
  for (const fn of listeners) fn();
}

function subscribeClock(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useClockZone(): ClockZone {
  return useSyncExternalStore(subscribeClock, getClockZone, () => "utc");
}

export function localZoneLabel(): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZoneName: "short",
    }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "Local";
  } catch {
    return "Local";
  }
}

export function ClockToggle() {
  useLocale();
  const zone = useClockZone();
  const next: ClockZone = zone === "utc" ? "local" : "utc";
  const abbr = zone === "utc" ? "UTC" : localZoneLabel();

  return (
    <button
      type="button"
      className={`top-pill clock-pill ${zone === "local" ? "clock-pill-local" : ""}`}
      aria-label={w.toggleTimezone}
      title={
        zone === "utc"
          ? `Showing UTC timestamps — click to switch to local time (${localZoneLabel()})`
          : "Showing local browser timestamps — click to switch to UTC"
      }
      onClick={() => setClockZone(next)}
    >
      <Clock3 size={13} />
      <span className="clock-pill-code">{abbr}</span>
    </button>
  );
}
