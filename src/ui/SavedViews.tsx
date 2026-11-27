import { useCallback, useState } from "react";
import { Bookmark as BookmarkIcon, Trash2 } from "lucide-react";
import { api, useRead, type SavedView } from "./api";
import { investigationUrl } from "./navigation";
import { StateMessage } from "./shared";
import w from "./en.json";

function href(view: SavedView) {
  const url = new URL(
    investigationUrl(view.connection, view.resource, view.around, view.view),
    location.origin,
  );
  if (view.incident) url.searchParams.set("incident", view.incident);
  return url.pathname + url.search;
}
function Bookmarks({
  selected,
}: {
  selected: Omit<SavedView, "title"> | null;
}) {
  const [generation, refresh] = useState(0);
  const load = useCallback(
    (signal: AbortSignal) => {
      void generation;
      return api.saved(signal);
    },
    [generation],
  );
  const result = useRead(load);
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
              onChange={(event) => setTitle(event.target.value)}
              required
              maxLength={120}
            />
          </label>
          <button className="button" disabled={pending || !title.trim()}>
            {w.save}
          </button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      {result.status === "ready" ? (
        <ul>
          {result.value.length === 0 ? (
            <li>{w.noSaved}</li>
          ) : (
            result.value.map((item) => (
              <li key={item.id}>
                <a href={href(item)}>
                  {item.title}
                  <small>{item.connection.name}</small>
                </a>
                <button
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
  return (
    <details
      className="saved"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <BookmarkIcon size={15} />
        {w.savedViews}
      </summary>
      {open && <Bookmarks selected={selected} />}
    </details>
  );
}
