import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  Compass,
  LockKeyhole,
  LogOut,
  Search,
  Sparkles,
} from "lucide-react";
import { api, isDemoMode, ReadDefaults, useRead } from "./api";
import type { PaletteDemoScenario } from "./CommandPalette";
import {
  appBasePath,
  navigate,
  parseRoute,
  spaClick,
  useLocationHref,
} from "./navigation";
import { ThemePicker } from "./themes";
import { ClockToggle, useClockZone } from "./clock";
import { LivePulseToggle } from "./livePulse";
import { McpButton } from "./McpModal";
import { ErrorBoundary } from "./ErrorBoundary";
import { Workspace } from "./Workspace";
import { StateMessage } from "./shared";
import { FleetFooter, LanguagePicker, useLocale, w } from "./i18n";
import logo from "../../vendor/culprit/docs/images/logo.svg";
import "@fontsource-variable/inter";
import "./style.css";

function loginUrl(provider: string) {
  return (
    "/auth/login/" +
    encodeURIComponent(provider) +
    "?" +
    new URLSearchParams({ return_to: location.pathname + location.search })
  );
}

function DemoTourMenu() {
  useLocale();
  const [open, setOpen] = useState(false);
  const [scenarios, setScenarios] = useState<PaletteDemoScenario[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    import("./demoMode").then((mod) => setScenarios(mod.getDemoScenarios()));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!scenarios.length) return null;

  return (
    <div className="demo-tour" ref={ref}>
      <button
        type="button"
        className="top-pill demo-pill"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Sparkles size={14} />
        <span className="top-pill-label">{w.interactiveDemo}</span>
      </button>
      {open && (
        <div
          className="theme-popover demo-popover panel"
          role="dialog"
          aria-label="Demo showcase tour"
        >
          <div className="theme-popover-head">
            <Compass size={14} />
            <span>{w.guidedScenarios}</span>
          </div>
          <div className="theme-list">
            {scenarios.map((sc) => (
              <button
                type="button"
                key={sc.label}
                className="theme-option"
                onClick={() => {
                  navigate(sc.href);
                  setOpen(false);
                }}
              >
                <span className="theme-option-copy">
                  <strong>{sc.label}</strong>
                  <small>{sc.detail}</small>
                </span>
                <ArrowRight size={14} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  useLocale();
  useLocationHref();
  useClockZone();
  const parsed = parseRoute();
  const investigating = parsed.kind === "investigate";
  const demo = isDemoMode();
  const [round, setRound] = useState(0);

  useEffect(() => {
    const expired = () => setRound((r) => r + 1);
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);

  const load = useCallback(
    (signal: AbortSignal) => {
      void round;
      return api.session(signal);
    },
    [round],
  );
  const session = useRead(load, "session");
  const access = session.status === "ready" ? session.value.access : null;
  const provider =
    session.status === "ready" &&
    !access &&
    investigating &&
    session.value.providers.length === 1
      ? session.value.providers[0]
      : undefined;

  useEffect(() => {
    if (provider) location.replace(loginUrl(provider.id));
  }, [provider]);

  return (
    <>
      <header className="top">
        <div className="top-inner">
          <a className="brand" href={appBasePath()} onClick={spaClick}>
            <img src={logo} alt="" />
            <span>{w.brand}</span>
          </a>
          <span className="brand-badge">{w.web}</span>
          <span className="divider" />
          <span className="workspace">{w.workspace}</span>

          <div className="top-controls">
            {demo && <DemoTourMenu />}
            {access && <LivePulseToggle />}
            <ClockToggle />
            {access && session.status === "ready" && (
              <McpButton providers={session.value.providers} />
            )}
            {access && (
              <button
                type="button"
                className="top-pill"
                aria-label={w.commandPalette}
                title={w.quickJumpTitle}
                onClick={() =>
                  window.dispatchEvent(new Event("open-command-palette"))
                }
              >
                <Search size={14} />
                <span className="top-pill-label">{w.jump}</span>
                <kbd aria-hidden="true">⌘K</kbd>
              </button>
            )}
            <LanguagePicker />
            <ThemePicker />
            {access && !demo && (
              <form action="/auth/logout" method="post">
                <button
                  className="icon-button top-icon-btn"
                  aria-label={w.signout}
                  title={w.signout}
                >
                  <LogOut size={16} />
                </button>
              </form>
            )}
          </div>
        </div>
      </header>
      <main>
        {session.status !== "ready" ? (
          <StateMessage
            error={session.status === "error" ? session.message : undefined}
          />
        ) : provider ? (
          <StateMessage />
        ) : access ? (
          <ReadDefaults.Provider value={session.value.read_defaults}>
            <ErrorBoundary resetKey={location.pathname + location.search}>
              <Workspace
                access={access}
                regions={session.value.regions ?? {}}
                savedEnabled={session.value.saved_views_enabled}
              />
            </ErrorBoundary>
          </ReadDefaults.Provider>
        ) : (
          <section className="signin panel">
            <div className="signin-icon">
              <LockKeyhole size={22} />
            </div>
            <h1>{w.signIn}</h1>
            <p>{w.unauthorized}</p>
            {session.value.providers.map((p) => (
              <a key={p.id} className="signin-link" href={loginUrl(p.id)}>
                <span>{p.label}</span>
                <ArrowRight size={15} />
              </a>
            ))}
          </section>
        )}
      </main>
      <FleetFooter />
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
