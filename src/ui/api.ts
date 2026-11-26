import { useEffect, useState } from "react";
import type { WarehouseConnectionRef } from "../../vendor/culprit/app/src/gen/WarehouseConnectionRef";
import type { WarehouseConnectionInfo } from "../../vendor/culprit/app/src/gen/WarehouseConnectionInfo";
import type { WarehouseFleetRequest } from "../../vendor/culprit/app/src/gen/WarehouseFleetRequest";
import type { WarehouseFleetReport } from "../../vendor/culprit/app/src/gen/WarehouseFleetReport";
import type { WarehouseIncidentView } from "../../vendor/culprit/app/src/gen/WarehouseIncidentView";
import type { WarehouseArtifactQuery } from "../../vendor/culprit/app/src/gen/WarehouseArtifactQuery";
import type { WarehouseArtifactReport } from "../../vendor/culprit/app/src/gen/WarehouseArtifactReport";
import type { PublishedResourceSelector } from "../../vendor/culprit/app/src/gen/PublishedResourceSelector";
import type { WarehouseWindowQuery } from "../../vendor/culprit/app/src/gen/WarehouseWindowQuery";
import type { WarehouseWindowReport } from "../../vendor/culprit/app/src/gen/WarehouseWindowReport";
import words from "./en.json";
export type { WarehouseConnectionRef, WarehouseFleetRequest, PublishedResourceSelector };
export interface Session {
  access: { inspect_evidence: boolean } | null;
  providers: { id: string; label: string }[];
}

async function request<T>(path: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    signal,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("session-expired"));
    const raw = await response.text();
    let message = raw;
    try {
      message = JSON.parse(raw).message || words.error;
    } catch {
      /* Plain-text transport error. */
    }
    throw new Error(message.slice(0, 400) || words.error);
  }
  return response.json() as Promise<T>;
}

export const api = {
  session: (signal: AbortSignal) => request<Session>("/api/session", signal),
  connection: async (signal: AbortSignal) => {
    const [c] = await request<WarehouseConnectionInfo[]>("/api/archive/connections", signal);
    if (!c) throw new Error(words.noArchive);
    return c.reference;
  },
  fleet: (connection: WarehouseConnectionRef, query: WarehouseFleetRequest, signal: AbortSignal) =>
    request<WarehouseFleetReport>("/api/archive/fleet", signal, { connection, request: query }),
  incident: (
    connection: WarehouseConnectionRef,
    resource: PublishedResourceSelector,
    around: string,
    signal: AbortSignal,
  ) => request<WarehouseIncidentView>("/api/archive/incident", signal, { connection, resource, around }),
  window: (connection: WarehouseConnectionRef, query: WarehouseWindowQuery, signal: AbortSignal) =>
    request<WarehouseWindowReport>("/api/archive/window", signal, { connection, request: query }),
  artifacts: (connection: WarehouseConnectionRef, query: WarehouseArtifactQuery, signal: AbortSignal) =>
    request<WarehouseArtifactReport>("/api/archive/artifacts", signal, { connection, request: query }),
};

type Load<T> = { status: "loading" } | { status: "ready"; value: T } | { status: "error"; message: string };
export function useRead<T>(load: (signal: AbortSignal) => Promise<T>): Load<T> {
  const [result, setResult] = useState<{ load: typeof load; data: Load<T> } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setResult({ load, data: { status: "ready", value } });
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            load,
            data: { status: "error", message: err instanceof Error ? err.message : words.error },
          });
      });
    return () => controller.abort();
  }, [load]);
  return result?.load === load ? result.data : { status: "loading" };
}
