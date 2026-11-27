import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

const browser = await chromium.launch();
const page = await browser.newPage({ baseURL: "http://127.0.0.1:4387" });

async function original(stream, expected) {
  const buttons = page.locator("article.case .evidence-button");
  await buttons
    .filter({ hasText: stream })
    .filter({ hasText: expected.manifest_sha256.slice(0, 16) })
    .first()
    .click();
  const full = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/archive/artifacts") &&
      response.request().postDataJSON().request.full_payloads,
  );
  await page.getByRole("button", { name: "Read full original" }).click();
  const result = await (await full).json();
  const row = result.records.find(
    (row) => row.reference.record_id === expected.record_id,
  );
  assert.ok(row, "original record matches the selected attribution");
  assert.equal(row.reference.manifest_sha256, expected.manifest_sha256);
  assert.equal(row.reference.payload_sha256, expected.payload_sha256);
  return row;
}

try {
  await page.goto("/");
  await page.getByRole("link", { name: "Company SSO" }).click();
  await page.getByRole("button", { name: "DBA", exact: true }).click();
  const resourcePath = process.argv[2] || await page.locator("a.db-link").first().getAttribute("href", { timeout: 60000 });
  assert.ok(resourcePath, "the DBA has a link to the published resource");
  const destination = new URL(resourcePath, page.url());
  assert.equal(destination.origin, new URL(page.url()).origin);
  const destArchive =
    destination.searchParams.get("archive") ||
    decodeURIComponent(destination.pathname.split("/")[2] || "");
  assert.equal(destArchive, "production");
  if (!destination.pathname.startsWith("/archives/")) {
    destination.searchParams.set("view", "incident");
  }
  const load = page.waitForResponse(
    (response) => response.url().endsWith("/api/archive/incident"),
    { timeout: 60000 },
  );
  await page.goto(destination.href);
  const response = await load;
  assert.equal(response.status(), 200, "the DBA can read the incident window");
  const view = await response.json();
  const revision = destination.searchParams.get("incident");
  const attributed = view.report.incidents.find(
    (incident) =>
      (!revision || incident.entry.revision_id === revision) &&
      incident.attribution_status === "established" &&
      incident.culprit_queries.some(
        (q) => q.causal_role?.kind === "native-blocking-owner",
      ),
  );
  assert.ok(attributed, "the collector established the native lock owner");
  if (!revision) {
    assert.ok(
      view.report.incidents.some(
        (incident) => incident.attribution_status === "unestablished",
      ),
      "unresolved revisions remain qualified",
    );
  }
  const link = new URL(page.url());
  link.searchParams.set("incident", attributed.entry.revision_id);
  await page.goto(link.href);
  await page.getByRole("heading", { name: "Attributed queries" }).waitFor();
  await original(
    attributed.revision_reference.stream,
    attributed.revision_reference,
  );
  const waiter = attributed.affected_queries.find(
    (query) => query.sql.state === "available",
  );
  assert.ok(waiter, "an affected statement is retained");
  const observation = waiter.evidence.find(
    (reference) => reference.stream === "activity-observations",
  );
  assert.ok(observation);
  const row = await original(observation.stream, observation);
  const statement = row.artifacts.find(
    (artifact) =>
      artifact.payload.kind === "metadata" &&
      artifact.payload.sha256 === waiter.sql.sha256,
  );
  assert.ok(
    statement,
    "the original inventory contains the archived affected statement",
  );
  const chunkResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/archive/artifacts") &&
      response.request().postDataJSON().request.text.kind === "chunk",
  );
  await page
    .locator(".records h4")
    .filter({ hasText: statement.label })
    .locator("..")
    .getByRole("button", { name: "Read captured text" })
    .first()
    .click();
  const chunkRead = await chunkResponse;
  assert.equal(chunkRead.status(), 200);
  const originalRequest = chunkRead.request().postDataJSON();
  const chunk = await chunkRead.json();
  const matching = chunk.records
    .flatMap((r) => r.artifacts)
    .find(
      (a) =>
        a.payload.kind === "chunk" && a.payload.sha256 === waiter.sql.sha256,
    );
  assert.ok(
    matching && matching.payload.text === waiter.sql.text,
    "redacted original text agrees with the affected query",
  );
  await page.getByText(waiter.sql.text, { exact: true }).last().waitFor();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto(link.href);
  await page.getByRole("button", { name: "Viewer", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Evidence access is required" })
    .waitFor();
  for (const [route, request] of [
    ["incident", response.request().postDataJSON()],
    ["artifacts", originalRequest],
  ]) {
    const denied = await page.request.post("/api/archive/" + route, { data: request });
    assert.equal(denied.status(), 403, "the viewer cannot replay the DBA's " + route + " request");
  }
  console.log(
    "The DBA opened the attributed blocking incident and verified the affected SQL against its original. The fleet viewer was denied the same link and original request.",
  );
} finally {
  await browser.close();
}
