// Local sample data for the production UI. This entry point is excluded from the web image.
import { resolve, sep } from "node:path";
import { archives, emptyIncidentView, fleet, sampleWindow } from "./archives";
import { resource, view } from "./estate";
import { warehouseArtifactCase } from "../vendor/culprit/app/src/test/warehouse-artifacts";

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
  return (await file.exists())
    ? new Response(file)
    : new Response(null, { status: 404 });
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
      if (url.pathname === "/api/session")
        return json({
          access: {
            archives: Object.fromEntries(archives.map((a) => [a.name, access])),
          },
          regions: Object.fromEntries(archives.map((a) => [a.name, a.region])),
          providers: [],
          saved_views_enabled: false,
          read_defaults: { window_page_rows: 50, artifact_chunk_chars: 4096 },
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
      case "/api/archive/incident": {
        return json(
          archive.checkout && body.resource.database === resource.database
            ? view
            : emptyIncidentView,
        );
      }
      case "/api/archive/window":
        return json(sampleWindow(archive, body.request));
      case "/api/archive/artifacts": {
        if (
          !archive.checkout ||
          body.request.resource.database !== resource.database
        )
          return new Response(null, { status: 404 });
        const report = warehouseArtifactCase(body.request);
        for (const record of report.records)
          for (const item of record.artifacts) {
            if (
              item.payload.kind === "complete" &&
              item.payload.payload.state === "available"
            )
              item.payload.payload.text =
                "UPDATE checkout.orders SET status = @status WHERE id = @order_id";
          }
        report.qualifications = ["Sample original from the demo estate."];
        return json(report);
      }
      default:
        return new Response(null, { status: 404 });
    }
  },
});
console.log("Culprit Web demo at " + server.url);
