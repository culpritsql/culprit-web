// Local sample data for the production UI. This entry point is excluded from the web image.
import { resolve, sep } from "node:path";
import {
  archives,
  computeDemoPlanDiff,
  fleet,
  incidentForResource,
  sampleArtifacts,
  sampleWindow,
} from "./archives";

const access = {
  view_fleet: true,
  inspect_evidence: true,
  export_evidence: false,
  resources: [],
};
const staticRoot = resolve("dist");
async function asset(pathname: string) {
  const path = resolve(
    staticRoot,
    "." + (pathname === "/" ? "/index.html" : pathname),
  );
  if (!path.startsWith(staticRoot + sep))
    return new Response(null, { status: 404 });
  const file = Bun.file(path);
  if (await file.exists()) return new Response(file);
  if (!pathname.includes(".")) {
    const index = Bun.file(resolve(staticRoot, "./index.html"));
    if (await index.exists()) return new Response(index);
  }
  return new Response(null, { status: 404 });
}
function json(value: unknown) {
  return new Response(
    JSON.stringify(value, (_, item) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
    {
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    },
  );
}
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.CULPRIT_DEMO_PORT ?? 4390),
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "GET") {
      if (url.pathname === "/.well-known/oauth-protected-resource")
        return json({
          resource: url.origin + "/mcp",
          authorization_servers: [
            "https://login.microsoftonline.com/common/v2.0",
          ],
          bearer_methods_supported: ["header"],
          scopes_supported: ["openid", "profile"],
          resource_name: "Culprit Fleet Archive MCP (Local Demo)",
        });
      if (url.pathname === "/api/session")
        return json({
          access: {
            archives: Object.fromEntries(archives.map((a) => [a.name, access])),
          },
          regions: Object.fromEntries(archives.map((a) => [a.name, a.region])),
          providers: [],
          saved_views_enabled: false,
          read_defaults: { window_page_rows: 8, artifact_chunk_chars: 4096 },
        });
      if (url.pathname === "/api/archive/connections")
        return json(
          archives.map(({ name, revision }) => ({
            reference: { name, revision },
          })),
        );
      if (url.pathname === "/auth/logout") return Response.redirect(url.origin);
      return asset(url.pathname);
    }
    if (req.method !== "POST") return new Response(null, { status: 405 });
    if (url.pathname === "/auth/logout")
      return Response.redirect(url.origin, 303);
    const body = await req.json();
    if (url.pathname === "/mcp") {
      const id = body.id ?? 1;
      if (body.method === "initialize") {
        return json({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "culprit-web-mcp", version: "0.1.0" },
          },
        });
      }
      if (body.method === "tools/list") {
        return json({
          jsonrpc: "2.0",
          id,
          result: {
            tools: [
              { name: "list_archives", description: "List authorized scale units and regions." },
              { name: "fleet_overview", description: "Query fleet health, incidents, CPU/Memory and silent targets." },
              { name: "investigate_incident", description: "Inspect root cause, blocker session, SQL and fix." },
              { name: "query_database_window", description: "Read Top SQL, waits, deadlocks or ranked schema/index fixes." },
              { name: "diff_execution_plans", description: "Parse and diff two native execution plans." },
            ],
          },
        });
      }
      if (body.method === "tools/call") {
        const name = body.params?.name;
        if (name === "list_archives") {
          return json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    archives.map((a) => ({
                      archive: a.name,
                      region: a.region,
                      databases: a.rows.length,
                    })),
                    null,
                    2,
                  ),
                },
              ],
            },
          });
        }
        const us = archives[0]!;
        const rep = fleet(us, {
          as_of: "2026-10-11T12:14:00.000Z",
          window: null,
          max_age_seconds: 3600,
          page_rows: 8,
          after: null,
          sort: "attention",
          filter: {
            environment: null,
            engine: null,
            attention_only: true,
            shared_group: null,
          },
        });
        return json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { archive: us.name, summary: rep.summary, rows: rep.rows.length },
                  null,
                  2,
                ),
              },
            ],
          },
        });
      }
      return json({ jsonrpc: "2.0", id, result: {} });
    }
    if (url.pathname === "/api/plans/diff") {
      return json(
        computeDemoPlanDiff(body.a, body.b, body.nameA, body.nameB),
      );
    }
    const archive = archives.find(
      (a) =>
        a.name === body.connection?.name &&
        a.revision === body.connection?.revision,
    );
    if (!archive)
      return new Response("Unknown sample archive", { status: 404 });
    switch (url.pathname) {
      case "/api/archive/fleet":
        return json(fleet(archive, body.request));
      case "/api/archive/incident":
        return json(incidentForResource(archive, body.resource.database));
      case "/api/archive/window":
        return json(sampleWindow(archive, body.request));
      case "/api/archive/artifacts": {
        const res = sampleArtifacts(archive, body.request);
        if (!res) return new Response(null, { status: 404 });
        return json(res);
      }
      default:
        return new Response(null, { status: 404 });
    }
  },
});
console.log("Culprit Web demo at " + server.url);
