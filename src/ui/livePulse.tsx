import { useEffect, useSyncExternalStore } from "react";
import { Pause, Radio } from "lucide-react";
import { isDemoMode } from "./api";

const isAutomated =
  typeof navigator !== "undefined" && Boolean(navigator.webdriver);

let liveEnabled = !isAutomated && isDemoMode();
let liveTick = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

function syncTimer() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (!liveEnabled || typeof window === "undefined") return;
  const intervalMs = isDemoMode() ? 3000 : 15000;
  timer = setInterval(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    liveTick += 1;
    notify();
  }, intervalMs);
}

if (typeof window !== "undefined") {
  syncTimer();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getLiveTick(): number {
  return liveTick;
}

export function useLiveTick(): number {
  return useSyncExternalStore(subscribe, () => liveTick, () => 0);
}

export function useLiveEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => liveEnabled, () => false);
}

export function setLiveEnabled(next: boolean) {
  liveEnabled = next;
  if (next) liveTick += 1;
  syncTimer();
  notify();
}

export function LivePulseToggle() {
  const enabled = useLiveEnabled();
  const demo = isDemoMode();

  useEffect(() => {
    const onVis = () => {
      if (!document.hidden && liveEnabled) {
        liveTick += 1;
        notify();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  return (
    <button
      type="button"
      className={`top-pill live-pill ${enabled ? "live-active" : ""}`}
      aria-pressed={enabled}
      title={
        enabled
          ? `Live auto-refresh active (${demo ? "3s stream" : "15s sink poll"}) — click to pause`
          : "Enable live auto-refresh as new captures land in the warehouse"
      }
      onClick={() => setLiveEnabled(!enabled)}
    >
      {enabled ? (
        <span className="live-pulse-dot" aria-hidden="true" />
      ) : (
        <Pause size={12} />
      )}
      {!enabled && <Radio size={12} className="live-radio-idle" />}
      <span className="top-pill-label">
        {enabled ? (demo ? "Live" : "Live · 15s") : "Live off"}
      </span>
    </button>
  );
}
