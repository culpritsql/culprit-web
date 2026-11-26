import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowRight, ChevronRight, LayoutGrid, LockKeyhole, LogOut } from "lucide-react";
import { api, useRead, type Session } from "./api";
import { Fleet } from "./Fleet";
import { Incident } from "./Incident";
import { StateMessage } from "./shared";
import logo from "../../vendor/culprit/docs/images/logo.svg";
import w from "./en.json";
import "./style.css";

const route = new URLSearchParams(location.search);
const selected = { namespace_id: route.get("namespace") ?? "", database: route.get("database") ?? "" };
const investigating = route.has("database");
const around = route.get("around") ?? "";

function Workspace({ access }: { access: NonNullable<Session["access"]> }) {
  const result = useRead(api.connection);
  if (result.status !== "ready")
    return <StateMessage error={result.status === "error" ? result.message : undefined} />;
  const connection = result.value;
  if (investigating) {
    if (!access.inspect_evidence) return <StateMessage error={w.role} />;
    if (
      route.get("revision") !== connection.revision ||
      ![selected.namespace_id, selected.database].every((s) => /^[a-f0-9]{64}$/.test(s)) ||
      !Number.isFinite(Date.parse(around))
    )
      return <StateMessage error={w.badLink} />;
    return (
      <Incident
        connection={connection}
        resource={selected}
        around={new Date(around).toISOString()}
        revisionId={route.get("incident")}
      />
    );
  }
  return <Fleet connection={connection} canInspect={access.inspect_evidence} />;
}

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
    session.status === "ready" && !access && investigating && session.value.providers.length === 1
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
          <span className="divider" />
          <span className="workspace">{w.workspace}</span>
          {access && (
            <form action="/auth/logout" method="post">
              <button className="icon-button" aria-label={w.signout} title={w.signout}>
                <LogOut size={18} />
              </button>
            </form>
          )}
        </div>
      </header>
      <main>
        {session.status !== "ready" ? (
          <StateMessage error={session.status === "error" ? session.message : undefined} />
        ) : provider ? (
          <StateMessage />
        ) : access ? (
          <>
            <nav className="crumb">
              <LayoutGrid size={15} />
              <a href="/">{w.fleet}</a>
              {investigating && (
                <>
                  <ChevronRight size={13} />
                  {w.progress}
                </>
              )}
            </nav>
            <Workspace access={access} />
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
