import { createContext, useContext, useEffect, useState } from "react";
import {
  createArchiveClient,
  createArchivePlanClient,
  type Plan,
  type PlanDiff,
  type PublishedResourceSelector,
  type WarehouseArtifactQuery,
  type WarehouseArtifactReport,
  type WarehouseConnectionRef,
  type WarehouseFleetRequest,
} from "../../vendor/culprit/packages/culprit-archive-client/src";
import words from "./en.json";
export type {
  Plan,
  PlanDiff,
  WarehouseConnectionRef,
  WarehouseFleetRequest,
  PublishedResourceSelector,
};
import type { Section, ArchiveRange } from "./navigation";

export function isDemoMode(): boolean {
  if (import.meta.env.VITE_DEMO_MODE === "true") return true;
  if (typeof window !== "undefined") {
    return new URLSearchParams(window.location.search).get("demo") === "1";
  }
  return false;
}

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
  providers: {
    id: string;
    label: string;
    issuer?: string;
    client_id?: string;
  }[];
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
  if (isDemoMode()) {
    const mod = await import("./demoMode");
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return mod.demoRequest<T>(method, path, body);
  }
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

const transport = <T,>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  signal?: AbortSignal,
) => request<T>(path, signal, body, method);

const archive = createArchiveClient(transport);
const plans = createArchivePlanClient(transport);

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
  parsePlan: plans.parsePlan,
  diffPlans: plans.diffPlans,
  exportPlan: plans.exportPlan,
  exportDiff: plans.exportDiff,
  mcp: (body: unknown, signal?: AbortSignal) =>
    request<Record<string, unknown>>("/mcp", signal, body, "POST"),
};

export type Load<T> =
  | { status: "loading"; refreshing?: false }
  | { status: "ready"; value: T; refreshing: boolean }
  | { status: "error"; message: string; refreshing?: false };

/**
 * Reads an async resource. Passing `scopeKey` enables stale-while-revalidate
 * within the same entity scope so filter/sort/page/refresh updates never
 * collapse DOM height or jump scroll position to top.
 */
export function useRead<T>(
  load: (signal: AbortSignal) => Promise<T>,
  scopeKey?: string,
): Load<T> {
  const [result, setResult] = useState<{
    load: typeof load;
    scopeKey: string | undefined;
    data: Load<T>;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setResult({
            load,
            scopeKey,
            data: { status: "ready", value, refreshing: false },
          });
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setResult({
            load,
            scopeKey,
            data: {
              status: "error",
              message: err instanceof Error ? err.message : words.error,
            },
          });
        }
      });
    return () => controller.abort();
  }, [load, scopeKey]);

  if (result?.load === load) return result.data;
  if (
    scopeKey !== undefined &&
    result?.scopeKey === scopeKey &&
    result.data.status === "ready"
  ) {
    return { status: "ready", value: result.data.value, refreshing: true };
  }
  return { status: "loading" };
}
