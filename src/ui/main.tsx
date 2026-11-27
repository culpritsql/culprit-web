import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowRight, LockKeyhole, LogOut } from "lucide-react";
import { api, ReadDefaults, useRead } from "./api";
import { Workspace } from "./Workspace";

import { StateMessage } from "./shared";
import logo from "../../vendor/culprit/docs/images/logo.svg";
import w from "./en.json";
import "@fontsource-variable/inter";
import "./style.css";

const route = new URLSearchParams(location.search);
const investigating = route.has("database");

function loginUrl(provider: string) {
  return (
    "/auth/login/" +
    encodeURIComponent(provider) +
    "?" +
    new URLSearchParams({ return_to: location.pathname + location.search })
  );
}
function App() {
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
  const session = useRead(load);
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
          <a className="brand" href="/">
            <img src={logo} alt="" />
            {w.brand}
          </a>
          <span className="brand-product">{w.web}</span>
          <span className="divider" />
          <span className="workspace">{w.workspace}</span>
          {access && (
            <form action="/auth/logout" method="post">
              <button
                className="icon-button"
                aria-label={w.signout}
                title={w.signout}
              >
                <LogOut size={18} />
              </button>
            </form>
          )}
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
          <>
            <ReadDefaults.Provider value={session.value.read_defaults}>
              <Workspace
                access={access}
                regions={session.value.regions ?? {}}
                savedEnabled={session.value.saved_views_enabled}
              />
            </ReadDefaults.Provider>
          </>
        ) : (
          <section className="signin panel">
            <LockKeyhole size={24} />
            <h1>{w.signIn}</h1>
            <p>{w.unauthorized}</p>
            {session.value.providers.map((p) => (
              <a key={p.id} className="signin-link" href={loginUrl(p.id)}>
                {p.label}
                <ArrowRight size={15} />
              </a>
            ))}
          </section>
        )}
      </main>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
