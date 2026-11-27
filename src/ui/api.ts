import { createContext, useContext, useEffect, useState } from "react";
import {
  createArchiveClient,
  type PublishedResourceSelector,
  type WarehouseArtifactQuery,
  type WarehouseArtifactReport,
  type WarehouseConnectionRef,
  type WarehouseFleetRequest,
} from "../../vendor/culprit/packages/culprit-archive-client/src";
import words from "./en.json";
export type {
  WarehouseConnectionRef,
  WarehouseFleetRequest,
  PublishedResourceSelector,
};
import type { Section, ArchiveRange } from "./navigation";
export type ArchiveScope = {
  connection: WarehouseConnectionRef;
  resource: PublishedResourceSelector;
};
export interface SavedView {
  title: string;
  connection: WarehouseConnectionRef;
  resource: PublishedResourceSelector;
  around: string;
  view: Section;
  incident: string | null;
  bounds?: ArchiveRange | null;
}
export type Bookmark = SavedView & { id: number };
export const ExportAccess = createContext(false);

export interface ArchiveAccess {
  view_fleet: boolean;
  inspect_evidence: boolean;
  export_evidence: boolean;
  resources: {
    label: string;
    selector: PublishedResourceSelector;
    inspect_evidence: boolean;
    export_evidence: boolean;
  }[];
}
export interface Session {
  regions?: Record<string, string>;
  saved_views_enabled: boolean;
  read_defaults: { window_page_rows: number; artifact_chunk_chars: number };
  access: { archives: Record<string, ArchiveAccess> } | null;
  providers: { id: string; label: string }[];
}

export const ReadDefaults = createContext<Session["read_defaults"] | null>(
  null,
);
export function useReadDefaults() {
  const defaults = useContext(ReadDefaults);
  if (!defaults) throw new Error(words.error);
  return defaults;
}

async function request<T>(
  path: string,
  signal: AbortSignal | undefined,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  const response = await fetch(path, {
    method,
    signal,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 401)
      window.dispatchEvent(new Event("session-expired"));
    const raw = await response.text();
    let message = raw;
    try {
      message = JSON.parse(raw).message || words.error;
    } catch {
      /* Plain-text transport error. */
    }
    throw new Error(message.slice(0, 400) || words.error);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const archive = createArchiveClient((method, path, body, signal) =>
  request(path, signal, body, method),
);

export const api = {
  saved: (signal: AbortSignal) =>
    request<Bookmark[]>("/api/workspace/saved", signal),
  save: (view: SavedView) =>
    request<void>("/api/workspace/saved", undefined, view),
  remove: (id: number) =>
    request<void>("/api/workspace/saved/" + id, undefined, undefined, "DELETE"),
  exportOriginal: (
    connection: WarehouseConnectionRef,
    query: WarehouseArtifactQuery,
    signal: AbortSignal,
  ) =>
    request<WarehouseArtifactReport>("/api/archive/export", signal, {
      connection,
      request: query,
    }),
  session: (signal: AbortSignal) => request<Session>("/api/session", signal),
  connections: async (signal: AbortSignal) =>
    (await archive.warehouseConnections(signal)).map(
      ({ reference }) => reference,
    ),
  fleet: archive.warehouseFleet,
  incident: archive.warehouseIncident,
  window: archive.warehouseWindow,
  artifacts: archive.warehouseArtifacts,
};

type Load<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "error"; message: string };
export function useRead<T>(load: (signal: AbortSignal) => Promise<T>): Load<T> {
  const [result, setResult] = useState<{
    load: typeof load;
    data: Load<T>;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted)
          setResult({ load, data: { status: "ready", value } });
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            load,
            data: {
              status: "error",
              message: err instanceof Error ? err.message : words.error,
            },
          });
      });
    return () => controller.abort();
  }, [load]);
  return result?.load === load ? result.data : { status: "loading" };
}
