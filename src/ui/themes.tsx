import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, Monitor, Moon, Palette, Sun, Terminal } from "lucide-react";

export type ThemeChoice =
  | "system"
  | "obsidian"
  | "midnight"
  | "terminal"
  | "daylight"
  | "nordic";

export type ResolvedTheme = Exclude<ThemeChoice, "system">;

export interface ThemeMeta {
  id: ThemeChoice;
  label: string;
  tagline: string;
  mode: "light" | "dark" | "system";
  swatches: [string, string, string];
}

export const THEMES: ThemeMeta[] = [
  {
    id: "system",
    label: "System",
    tagline: "Follow OS light or dark mode",
    mode: "system",
    swatches: ["#0d1117", "#38bdf8", "#f6f6f2"],
  },
  {
    id: "obsidian",
    label: "Culprit Obsidian",
    tagline: "Deep carbon slate & cyan telemetry",
    mode: "dark",
    swatches: ["#0b0f17", "#141b26", "#38bdf8"],
  },
  {
    id: "midnight",
    label: "Midnight Nebula",
    tagline: "Cosmic indigo & violet luminescence",
    mode: "dark",
    swatches: ["#0a0817", "#15122b", "#a78bfa"],
  },
  {
    id: "terminal",
    label: "Operator Terminal",
    tagline: "High-contrast NOC phosphor & amber",
    mode: "dark",
    swatches: ["#070b08", "#0f1712", "#22c55e"],
  },
  {
    id: "daylight",
    label: "Daylight Paper",
    tagline: "Warm alabaster & forest ink",
    mode: "light",
    swatches: ["#f6f6f2", "#ffffff", "#176646"],
  },
  {
    id: "nordic",
    label: "Nordic Frost",
    tagline: "Crisp polar slate & glacier blue",
    mode: "light",
    swatches: ["#f1f5f9", "#ffffff", "#0284c7"],
  },
];

const STORAGE_KEY = "culprit-web-theme";
const VALID_CHOICES = new Set<ThemeChoice>(THEMES.map((t) => t.id));

function readStoredChoice(): ThemeChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) as ThemeChoice | null;
    if (raw && VALID_CHOICES.has(raw)) return raw;
  } catch {
    /* Restricted storage context. */
  }
  return "system";
}

function prefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === "system") return prefersDark() ? "obsidian" : "daylight";
  return choice;
}

export function themeColorMode(theme: ResolvedTheme): "light" | "dark" {
  return theme === "daylight" || theme === "nordic" ? "light" : "dark";
}

function applyDocumentTheme(choice: ThemeChoice) {
  if (typeof document === "undefined") return;
  const resolved = resolveTheme(choice);
  const mode = themeColorMode(resolved);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.colorMode = mode;
  document.documentElement.style.colorScheme = mode;
}

let currentSnapshot = `${readStoredChoice()}:${prefersDark() ? "dark" : "light"}`;

function getSnapshot(): string {
  const next = `${readStoredChoice()}:${prefersDark() ? "dark" : "light"}`;
  if (next !== currentSnapshot) currentSnapshot = next;
  return currentSnapshot;
}

const listeners = new Set<() => void>();

function emit() {
  applyDocumentTheme(readStoredChoice());
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  applyDocumentTheme(readStoredChoice());
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  media?.addEventListener?.("change", emit);
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) emit();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setThemeChoice(choice: ThemeChoice) {
  try {
    if (choice === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    /* Ignore quota/storage errors. */
  }
  emit();
}

export function useTheme() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, () => "system:light");
  const choice = (snap.split(":")[0] as ThemeChoice) || "system";
  const resolved = resolveTheme(choice);
  const colorMode = themeColorMode(resolved);
  return {
    choice,
    resolved,
    colorMode,
    setTheme: setThemeChoice,
  };
}

export function ThemePicker() {
  const { choice, resolved, colorMode, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node))
        setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const activeMeta = THEMES.find((t) => t.id === choice) ?? THEMES[0];
  const Icon =
    choice === "system"
      ? Monitor
      : resolved === "terminal"
        ? Terminal
        : colorMode === "dark"
          ? Moon
          : Sun;

  return (
    <div className="theme-picker" ref={wrapRef}>
      <button
        type="button"
        className="top-pill"
        aria-label="Theme"
        aria-expanded={open}
        title={`Theme: ${activeMeta.label}`}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon size={15} />
        <span className="top-pill-label">{activeMeta.label}</span>
      </button>
      {open && (
        <div className="theme-popover panel" role="dialog" aria-label="Choose theme">
          <div className="theme-popover-head">
            <Palette size={14} />
            <span>Appearance</span>
          </div>
          <div className="theme-list">
            {THEMES.map((theme) => {
              const selected = theme.id === choice;
              return (
                <button
                  type="button"
                  key={theme.id}
                  className="theme-option"
                  data-selected={selected}
                  onClick={() => {
                    setTheme(theme.id);
                    setOpen(false);
                  }}
                >
                  <span className="theme-swatches" aria-hidden="true">
                    {theme.swatches.map((hex, idx) => (
                      <i key={idx} style={{ background: hex }} />
                    ))}
                  </span>
                  <span className="theme-option-copy">
                    <strong>{theme.label}</strong>
                    <small>{theme.tagline}</small>
                  </span>
                  {selected && <Check size={15} className="theme-check" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
