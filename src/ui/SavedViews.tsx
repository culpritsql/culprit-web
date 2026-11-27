import { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark as BookmarkIcon, ChevronDown, Trash2 } from "lucide-react";
import { api, useRead, type SavedView } from "./api";
import { investigationUrl, putRange, spaClick } from "./navigation";
import { StateMessage } from "./shared";
import w from "./en.json";

function href(view: SavedView) {
  const url = new URL(
    investigationUrl(view.connection, view.resource, view.around, view.view),
    location.origin,
  );
  if (view.bounds) putRange(url.searchParams, view.bounds);
  if (view.incident) url.searchParams.set("incident", view.incident);
  return url.pathname + url.search;
}

function Bookmarks({
  selected,
  onNavigate,
}: {
  selected: Omit<SavedView, "title"> | null;
  onNavigate: () => void;
}) {
  const [generation, refresh] = useState(0);
  const load = useCallback(
    (signal: AbortSignal) => {
      void generation;
      return api.saved(signal);
    },
    [generation],
  );
  const result = useRead(load, "saved-bookmarks");
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function change(action: () => Promise<void>) {
    setPending(true);
    setError("");
    try {
      await action();
      refresh((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : w.error);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="saved-menu panel">
      {selected && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void change(async () => {
              await api.save({ ...selected, title: title.trim() });
              setTitle("");
            });
          }}
        >
          <label>
            {w.saveTitle}
            <input
              value={title}
              placeholder="e.g. Checkout lock regression"
              onChange={(event) => setTitle(event.target.value)}
              required
              maxLength={120}
            />
          </label>
          <button
            className="button button-accent"
            disabled={pending || !title.trim()}
          >
            {w.save}
          </button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      {result.status === "ready" ? (
        <ul>
          {result.value.length === 0 ? (
            <li className="saved-empty">{w.noSaved}</li>
          ) : (
            result.value.map((item) => (
              <li key={item.id}>
                <a
                  href={href(item)}
                  onClick={(e) => {
                    onNavigate();
                    spaClick(e);
                  }}
                >
                  <strong>{item.title}</strong>
                  <small>
                    {item.connection.name} · {item.view}
                  </small>
                </a>
                <button
                  type="button"
                  className="icon-button"
                  disabled={pending}
                  aria-label={w.remove + " " + item.title}
                  onClick={() => void change(() => api.remove(item.id))}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))
          )}
        </ul>
      ) : (
        <StateMessage
          error={result.status === "error" ? result.message : undefined}
        />
      )}
    </div>
  );
}

export function SavedViews({
  selected,
}: {
  selected: Omit<SavedView, "title"> | null;
}) {
  const [open, setOpen] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);

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

  return (
    <details
      className="saved"
      ref={detailsRef}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <BookmarkIcon size={14} />
        <span>{w.savedViews}</span>
        <ChevronDown size={13} className="select-chevron" />
      </summary>
      {open && (
        <Bookmarks
          selected={selected}
          onNavigate={() => {
            if (detailsRef.current) detailsRef.current.open = false;
          }}
        />
      )}
    </details>
  );
}
