import { expect, test } from "@playwright/test";

test("multi-theme switcher, clean routing, scroll stability, telemetry, schema/operations and plan diff work end to end", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 620 });
  await page.goto("http://127.0.0.1:4391/");

  // Verify Global 24h / 7d / 30d Fleet Command Dashboard
  await expect(
    page.getByRole("heading", { name: "Incident volume & resolution (24h)" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "7 days" }).click();
  await expect(
    page.getByRole("heading", { name: "Incident volume & resolution (7d)" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "What needs attention across the estate",
    }),
  ).toBeVisible();

  // Regional topology -> open US Demo estate on clean /archives/... path
  await page
    .getByRole("article")
    .filter({ hasText: "United States" })
    .getByRole("link", { name: "Open fleet" })
    .click();

  await expect(page).toHaveURL(/\/archives\/Demo%20estate/);
  await expect(
    page.getByRole("link", { name: "Checkout", exact: true }),
  ).toBeVisible();

  // Verify scroll does NOT jump to top when toggling All resources / Needs attention
  await page.evaluate(() => window.scrollTo(0, 320));
  const beforeScroll = await page.evaluate(() => window.scrollY);
  expect(beforeScroll).toBeGreaterThan(200);
  await page.getByRole("button", { name: "Needs attention" }).click();
  const afterScroll = await page.evaluate(() => window.scrollY);
  expect(afterScroll).toBeGreaterThan(150);
  await page.getByRole("button", { name: "All resources" }).click();

  // Verify custom scale-unit switcher popover
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByText("Scale units & archives")).toBeVisible();
  await page.keyboard.press("Escape");

  // Verify silent collector targets & pool grouping
  await expect(page.getByText("payments-pci-vault")).toBeVisible();
  await page.getByRole("button", { name: "Group by pool / cluster" }).click();
  await expect(page.getByText(/pool-commerce \(pool\)/)).toBeVisible();

  // Test multi-theme switcher across themes
  await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("button", { name: /Midnight Nebula/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight");

  await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("button", { name: /Culprit Obsidian/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "obsidian");

  // Open Checkout -> verify Telemetry correlation strip has ZERO layout shift on hover
  await page.getByRole("link", { name: "Checkout", exact: true }).click();
  await expect(page).toHaveURL(/\/archives\/Demo%20estate\/investigate\/incident/);
  const corrStrip = page.getByRole("region", {
    name: "Synchronized window telemetry",
  });
  await expect(corrStrip).toBeVisible();
  const boxBefore = await corrStrip.boundingBox();
  await corrStrip.locator(".corr-track").first().hover({ position: { x: 180, y: 20 } });
  const boxHover = await corrStrip.boundingBox();
  expect(boxHover?.height).toBe(boxBefore?.height);

  // Resources & waits -> CPU/Memory + Blocking chain + Deadlocks
  await page.getByRole("link", { name: "Resources & waits" }).click();
  await expect(page).toHaveURL(/\/archives\/Demo%20estate\/investigate\/resources/);
  await expect(
    page.getByText("CPU utilization", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Memory utilization", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Wait class breakdown" }),
  ).toBeVisible();
  await expect(page.getByText(/HEAD BLOCKER · Session 84/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Captured deadlock graphs/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /SQL Server database & tempdb file capacity/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /SQL Server memory clerks/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Active request memory grants/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /TempDB, sort & hash workspace spills/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /SQL Server Agent jobs/ }),
  ).toBeVisible();

  // Verify Schema and indexes & Operations tabs have rich findings + SQL remediation
  await page.getByRole("link", { name: "Schema and indexes", exact: true }).click();
  await expect(page).toHaveURL(/\/archives\/Demo%20estate\/investigate\/schema/);
  await expect(
    page.getByText(/Key lookup on shop\.customers/),
  ).toBeVisible();

  await page.getByRole("link", { name: "Operations", exact: true }).click();
  await expect(page).toHaveURL(/\/archives\/Demo%20estate\/investigate\/operations/);
  await expect(
    page.getByText(/READ_COMMITTED_SNAPSHOT is OFF/),
  ).toBeVisible();

  // Workload -> Top SQL -> Rank by CPU + Slide-Over Query Inspector Drawer (<PlanDiffViewer>)
  await page.getByRole("link", { name: "Workload", exact: true }).click();
  await page.getByRole("button", { name: "CPU (ms)" }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "2 plans" })
    .locator(".statement-toggle")
    .click();
  const drawer = page.getByRole("dialog", {
    name: "Statement inspector",
  });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Compare plans" }).first().click();
  await expect(drawer.getByText(/higher estimated cost/i)).toBeVisible();
  await drawer.getByRole("button", { name: "Close statement inspector" }).click();
  await expect(drawer).toHaveCount(0);

  // Verify MCP Coding Agent modal portals outside sticky header + live JSON-RPC tester
  await page.getByRole("button", { name: "Connect coding agent via MCP" }).click();
  const topHeaderBox = await page.locator("header.top").boundingBox();
  expect(topHeaderBox?.height).toBeLessThanOrEqual(68);
  const mcpDialog = page.getByRole("dialog", {
    name: "Connect coding agent via MCP",
  });
  await expect(mcpDialog).toBeVisible();
  const mcpBox = await mcpDialog.boundingBox();
  expect(mcpBox?.width).toBeGreaterThanOrEqual(500);
  await mcpDialog.getByRole("button", { name: "Live Tester" }).click();
  await mcpDialog.getByRole("button", { name: "Run tools/list" }).click();
  await expect(mcpDialog.getByText(/"name": "investigate_incident"/)).toBeVisible();
  await mcpDialog.getByRole("button", { name: "Close MCP modal" }).click();
  await expect(mcpDialog).toHaveCount(0);

  // Command palette (Quick jump) -> PostgreSQL Orders also has rich Schema data!
  await page.getByRole("button", { name: "Quick jump" }).click();
  const paletteInput = page.getByLabel(
    "Jump to database, region, view or theme",
  );
  await paletteInput.fill("Orders");
  await paletteInput.press("Enter");
  await expect(
    page.getByRole("heading", {
      name: "Read-replica WAL replay lag exceeded 18 seconds",
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Schema and indexes", exact: true }).click();
  await expect(
    page.getByText(/Unindexed filter & foreign key on public\.order_items/),
  ).toBeVisible();
});

test("browser-only static demo mode runs with zero backend API requests", async ({
  page,
}) => {
  const apiHits: string[] = [];
  page.on("request", (req) => {
    if (new URL(req.url()).pathname.startsWith("/api/")) {
      apiHits.push(req.url());
    }
  });

  await page.goto("http://127.0.0.1:4391/?demo=1");
  await expect(page.getByRole("article")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "Interactive Demo" }),
  ).toBeVisible();

  // Navigate via Interactive Demo tour menu
  await page.getByRole("button", { name: "Interactive Demo" }).click();
  await page
    .getByRole("button", { name: /Checkout Lock Storm & Blocking Tree/ })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Checkout requests waited on an open transaction",
    }),
  ).toBeVisible();

  // Verify client-side saved investigations work in static mode
  await page.getByText("Saved investigations", { exact: true }).click();
  await expect(
    page.getByRole("link", { name: /Checkout lock storm/ }),
  ).toBeVisible();

  expect(apiHits).toEqual([]);
});
