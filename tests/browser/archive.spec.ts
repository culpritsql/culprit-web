import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { execFileSync } from "node:child_process";

// Bun reads the upstream TS/JSON fixture with the same module semantics as the Culprit app.
const incidentFixture = execFileSync(
  "bun",
  [
    "-e",
    `
  import { warehouseIncidentCase } from "./vendor/culprit/app/src/test/warehouse-incidents.ts";
  console.log(JSON.stringify(warehouseIncidentCase("Blocked checkout"), (_, value) =>
    typeof value === "bigint" ? value.toString() : value));
`,
  ],
  { encoding: "utf8" },
);

const resource = { namespace_id: "a".repeat(64), database: "b".repeat(64) };
const around = "2026-11-22T10:00:01Z";
async function fixture(page: Page) {
  await page.route("**/api/archive/fleet", (route) => {
    const request = route.request().postDataJSON().request;
    return route.fulfill({
      json: {
        request,
        summary: {
          evaluated_resources: 1,
          attention_resources: 1,
          active_incidents: 1,
          high_finding_resources: 0,
          regression_resources: 0,
          stale_or_partial_resources: 0,
        },
        rows: [
          {
            resource_id: "orders",
            selector: resource,
            engine: "postgres",
            database_name: "Orders",
            connection_alias: "orders",
            environment: "production",
            shared_group: null,
            freshness: "observed",
            latest_collected_from: around,
            latest_collected_until: around,
            latest_observed_until: around,
            active_incidents: 1,
            uncertain_incidents: 0,
            high_findings: 0,
            actionable_findings: 0,
            recent_regressions: 0,
            recent_changes: 0,
            input_read_complete: true,
            limitations: [],
          },
        ],
        discovery_complete: true,
        gaps: [],
        qualifications: [],
        next: null,
      },
    });
  });
}
async function signIn(page: Page, role: string) {
  await page.getByRole("link", { name: "Company SSO" }).click();
  await page.getByRole("button", { name: role, exact: true }).click();
}

test("investigator follows an archive deep link through SSO and inspects original coverage", async ({
  page,
}) => {
  await fixture(page);
  await page.route("**/api/archive/incident", (route) => {
    expect(route.request().postDataJSON().resource).toEqual(resource);
    return route.fulfill({
      contentType: "application/json",
      body: incidentFixture,
    });
  });
  await page.route("**/api/archive/artifacts", (route) => {
    const query = route.request().postDataJSON().request;
    expect(query.references).toHaveLength(1);
    return route.fulfill({
      json: {
        query,
        records: [],
        gaps: [
          {
            kind: "original-not-committed",
            capture: query.references[0].capture,
          },
        ],
        qualifications: [],
      },
    });
  });
  await page.goto("/");
  await signIn(page, "DBA");
  await page.getByRole("link", { name: "Orders" }).click();
  await expect(page.getByText("Blocked checkout")).toBeVisible();
  await page.getByRole("link", { name: "Link to this incident" }).click();
  const link = page.url();
  await page.getByRole("button", { name: /operational-samples/ }).click();
  await expect(
    page.getByText("No original record was returned."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto(link);
  await page.getByRole("button", { name: "DBA", exact: true }).click();
  await expect(page).toHaveURL(link);
  await expect(page.getByText("Blocked checkout")).toBeVisible();
});
test("a viewer can see fleet and is denied original and incident reads by the server", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/");
  await signIn(page, "Viewer");
  await expect(
    page.getByRole("heading", { name: "Fleet overview" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Orders" })).toHaveCount(0);
  for (const path of ["incident", "artifacts", "window"]) {
    expect(
      (await page.request.post("/api/archive/" + path, { data: {} })).status(),
    ).toBe(403);
  }
});
test("unmapped users receive no session", async ({ page }) => {
  await page.goto("/");
  await signIn(page, "Guest");
  await expect(
    page.getByText("Ask your administrator for access to this archive."),
  ).toBeVisible();
  expect(
    (await page.request.post("/api/archive/fleet", { data: {} })).status(),
  ).toBe(401);
});

function presentationReport(
  module: "warehouse-artifacts" | "warehouse-windows",
  query: unknown,
) {
  const factory =
    module === "warehouse-artifacts"
      ? "warehouseArtifactCase"
      : "warehouseWindowCase";
  const script = `import { ${factory} as fixture } from "./vendor/culprit/app/src/test/${module}.ts";
    const value = fixture(JSON.parse(process.argv[1]));
    console.log(JSON.stringify(value, (_,v)=>typeof v==="bigint"?v.toString():v));`;
  return execFileSync("bun", ["-e", script, JSON.stringify(query)], {
    encoding: "utf8",
  });
}

test("original inventory and paged window stay bound to the investigation on a narrow screen", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page.route("**/api/archive/incident", (route) =>
    route.fulfill({ contentType: "application/json", body: incidentFixture }),
  );
  await page.route("**/api/archive/artifacts", (route) => {
    const query = route.request().postDataJSON().request;
    expect(query.resource).toEqual(resource);
    if (!query.full_payloads)
      return route.fulfill({
        json: { query, records: [], gaps: [], qualifications: [] },
      });
    return route.fulfill({
      contentType: "application/json",
      body: presentationReport("warehouse-artifacts", query),
    });
  });
  await page.route("**/api/archive/window", (route) => {
    const query = route.request().postDataJSON().request;
    expect(query.window.from).toBe("2026-11-22T09:55:00Z");
    expect(query.as_of).toBe("2026-11-22T12:00:00Z");
    return route.fulfill({
      contentType: "application/json",
      body: presentationReport("warehouse-windows", query),
    });
  });
  await page.goto("/");
  await signIn(page, "DBA");
  await page.getByRole("link", { name: "Orders" }).click();
  await page.getByRole("button", { name: /operational-samples/ }).click();
  await page.getByRole("button", { name: "Read full original" }).click();
  await expect(
    page.getByText("presentation-only", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Published findings and changes" })
    .click();
  await expect(page.getByText("Historical setting difference")).toBeVisible();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("mobile-investigation.png"),
    fullPage: true,
  });
});

test("an authenticated shared link opens directly and preserves the archived revision", async ({
  page,
}, info) => {
  await fixture(page);
  await page.route("**/api/archive/incident", (route) =>
    route.fulfill({ contentType: "application/json", body: incidentFixture }),
  );
  await page.goto("/");
  await signIn(page, "DBA");
  await expect(page.getByRole("link", { name: "Orders" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("fleet.png") });
  await page.getByRole("link", { name: "Orders" }).click();
  const link = await page
    .getByRole("link", { name: "Link to this incident" })
    .getAttribute("href");
  await page.goto(link!);
  await expect(page.getByText("Blocked checkout")).toBeVisible();
  await page.screenshot({ path: info.outputPath("incident.png") });
  const outdated = new URL(page.url());
  outdated.searchParams.set("revision", "unknown");
  await page.goto(outdated.href);
  await expect(page.getByRole("alert")).toContainText(
    "different archive revision",
  );
});

test("a database assignment authorizes the exact namespace and never grants fleet access", async ({
  page,
}) => {
  await page.goto("/");
  await signIn(page, "Orders team");
  await expect(
    page.getByRole("heading", { name: "Assigned databases" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Orders" })).toBeVisible();
  const archives = await (
    await page.request.get("/api/archive/connections")
  ).json();
  expect(
    archives.map((a: { reference: { name: string } }) => a.reference.name),
  ).toEqual(["production"]);
  const connection = archives[0].reference;
  const post = (path: string, data: unknown) =>
    page.request.post("/api/archive/" + path, { data });
  expect((await post("fleet", { connection })).status()).toBe(403);
  for (const different of [
    { ...resource, namespace_id: "d".repeat(64) },
    { ...resource, database: "d".repeat(64) },
  ]) {
    expect(
      (
        await post("incident", { connection, resource: different, around })
      ).status(),
    ).toBe(403);
    for (const path of ["window", "artifacts"])
      expect(
        (
          await post(path, { connection, request: { resource: different } })
        ).status(),
      ).toBe(403);
  }
  expect(
    (
      await post("incident", {
        connection: { ...connection, name: "restricted" },
        resource,
        around,
      })
    ).status(),
  ).toBe(403);
  await page.route("**/api/archive/incident", (route) =>
    route.fulfill({ contentType: "application/json", body: incidentFixture }),
  );
  await page.getByRole("link", { name: "Orders" }).click();
  await expect(page.getByText("Blocked checkout")).toBeVisible();
});

test("saved investigations preserve their source scope and disappear after the inspection grant is removed", async ({
  page,
}) => {
  await fixture(page);
  await page.route("**/api/archive/incident", (route) =>
    route.fulfill({ contentType: "application/json", body: incidentFixture }),
  );
  await page.goto("/");
  await signIn(page, "DBA");
  await page.getByRole("link", { name: "Orders" }).click();
  await page.getByText("Saved investigations", { exact: true }).click();
  await page.getByLabel("Investigation name").fill("Checkout review");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const saved = page.getByRole("link", { name: "Checkout review" });
  await expect(saved).toBeVisible();
  const bookmarks = await (
    await page.request.get("/api/workspace/saved")
  ).json();
  const item = bookmarks.find(
    (b: { title: string }) => b.title === "Checkout review",
  );
  expect(item.resource).toEqual(resource);
  expect(
    (
      await page.request.post("/api/archive/export", {
        data: { connection: item.connection, request: { resource } },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.delete("/api/workspace/saved/" + item.id, {
        headers: { Origin: "https://different.example" },
      })
    ).status(),
  ).toBe(403);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/");
  await signIn(page, "Viewer");
  expect(await (await page.request.get("/api/workspace/saved")).json()).toEqual(
    [],
  );
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/");
  await signIn(page, "DBA");
  await page.getByText("Saved investigations", { exact: true }).click();
  await page.getByRole("button", { name: "Remove Checkout review" }).click();
  await expect(
    page.getByText("You have no saved investigations."),
  ).toBeVisible();
});

test("an explicit UTC range stays selected across workload, operational and schema reads", async ({
  page,
}) => {
  await fixture(page);
  await page.route("**/api/archive/incident", (route) =>
    route.fulfill({ contentType: "application/json", body: incidentFixture }),
  );
  await page.route("**/api/archive/window", (route) => {
    const query = route.request().postDataJSON().request;
    if (query.as_of.endsWith(".000Z")) {
      expect(query.window.from).toBe("2026-11-22T09:57:00.000Z");
      expect(query.window.until).toBe("2026-11-22T10:05:00.000Z");
    }
    return route.fulfill({
      contentType: "application/json",
      body: presentationReport("warehouse-windows", query),
    });
  });
  await page.goto("/");
  await signIn(page, "DBA");
  await page.getByRole("link", { name: "Orders" }).click();
  await page.getByRole("link", { name: "Workload", exact: true }).click();
  await page.locator(".range-control summary").click();
  await page
    .getByLabel("From (UTC)", { exact: true })
    .fill("2026-11-22T09:57:00");
  await page.getByRole("button", { name: "Open window" }).click();
  await expect(page).toHaveURL(/asof=/);
  await expect(
    page.getByText(
      "No compatible workload intervals were returned for this window.",
    ),
  ).toBeVisible();
  await page.getByRole("link", { name: "Operations", exact: true }).click();
  await expect(page.getByText("Historical setting difference")).toBeVisible();
  await page
    .getByRole("link", { name: "Schema and indexes", exact: true })
    .click();
  await expect(
    page.getByText(
      "No matching findings or changes in this published analysis.",
    ),
  ).toBeVisible();
  await page.getByRole("link", { name: "Timeline", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Incident revisions" }),
  ).toBeVisible();
});

test("regional fleets restrict discovery, isolate an unavailable archive and route duplicate database names", async ({
  page,
}) => {
  await fixture(page);
  const reads: string[] = [];
  let europeOffline = true;
  await page.route("**/api/archive/fleet", async (route) => {
    const { connection } = route.request().postDataJSON();
    reads.push(connection.name);
    if (connection.name === "restricted" && europeOffline)
      return route.fulfill({
        status: 503,
        body: "European archive unavailable",
      });
    await route.fallback();
  });
  await page.route("**/api/archive/incident", (route) => {
    const value = JSON.parse(incidentFixture);
    const archive = route.request().postDataJSON().connection.name;
    value.report.incidents[0].entry.title = archive + " blocking incident";
    return route.fulfill({ json: value });
  });
  await page.goto("/?view=regions");
  expect(
    (await (await page.request.get("/api/session")).json()).regions,
  ).toEqual({});
  await signIn(page, "Regional DBA");
  const us = page.getByRole("article").filter({ hasText: "United States" });
  const europe = page.getByRole("article").filter({ hasText: "Europe" });
  await expect(us.locator("dd").first()).toHaveText("1");
  await expect(europe.getByRole("alert")).toHaveText(
    "European archive unavailable",
  );
  expect(
    (await (await page.request.get("/api/session")).json()).regions,
  ).toEqual({ production: "United States", restricted: "Europe" });
  expect(await page.getByText("Japan").count()).toBe(0);
  expect(reads.sort()).toEqual(["production", "restricted"]);
  europeOffline = false;
  await europe.getByRole("link", { name: "Open fleet" }).click();
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "restricted blocking incident" }),
  ).toBeVisible();
  const euLink = page.url();
  await page.getByLabel("Archive", { exact: true }).selectOption("production");
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "production blocking incident" }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get("database")).toBe(
    new URL(euLink).searchParams.get("database"),
  );
  await page.goto(euLink);
  await expect(
    page.getByRole("heading", { name: "restricted blocking incident" }),
  ).toBeVisible();
});
