import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import type { WarehouseFleetRow } from "../../vendor/culprit/app/src/gen/WarehouseFleetRow";
import type { WarehouseIncidentView } from "../../vendor/culprit/app/src/gen/WarehouseIncidentView";
import type { WarehouseWindowQuery } from "../../vendor/culprit/app/src/gen/WarehouseWindowQuery";
import type { Workload } from "../../vendor/culprit/app/src/gen/Workload";

// The README runs through the production React bundle and signed OIDC flow.
// Only archive responses are substituted. Statement statistics and plans are the Studio sample.
const sample = JSON.parse(
  await readFile("vendor/culprit/fixtures/mssql-demo.report.json", "utf8"),
).snapshot;
const workload: Workload = sample.workload;
const around = sample.taken_at;
const before = (seconds: number) =>
  new Date(Date.parse(around) - seconds * 1000).toISOString();
const resource = { namespace_id: "a".repeat(64), database: "b".repeat(64) };
const entries: [
  string,
  WarehouseFleetRow["engine"],
  string,
  number,
  number,
  WarehouseFleetRow["freshness"],
][] = [
  ["Checkout", "mssql", "Production", 3, 2, "observed"],
  ["Orders", "postgres", "Production", 2, 1, "observed"],
  ["Ledger", "mssql", "Production", 1, 0, "partial"],
  ["Fulfillment", "mysql", "Production", 0, 1, "stale"],
  ["Catalog", "postgres", "Production", 0, 0, "observed"],
  ["Customer insights", "mysql", "Analytics", 0, 0, "observed"],
  ["Inventory", "postgres", "Staging", 0, 0, "observed"],
  ["Billing", "mssql", "Staging", 0, 0, "observed"],
];
const rows: WarehouseFleetRow[] = entries.map(
  ([name, engine, environment, active, high, freshness], i) => {
    const at = before(freshness === "stale" ? 7200 : i * 14);
    return {
      resource_id: name,
      selector: i
        ? { ...resource, database: i.toString(16).repeat(64) }
        : resource,
      database_name: name,
      engine,
      environment,
      active_incidents: active,
      high_findings: high,
      freshness,
      connection_alias: name.toLowerCase(),
      shared_group: null,
      latest_collected_from: at,
      latest_collected_until: at,
      latest_observed_from: at,
      latest_observed_until: at,
      uncertain_incidents: 0,
      actionable_findings: high,
      recent_regressions: 0,
      recent_changes: 0,
      input_read_complete: freshness !== "partial",
      limitations: [],
    };
  },
);

function incidentScenario(): WarehouseIncidentView {
  const script =
    'import { warehouseIncidentCase } from "./vendor/culprit/app/src/test/warehouse-incidents"; console.log(JSON.stringify(warehouseIncidentCase(),(_,v)=>typeof v==="bigint"?v.toString():v));';
  const view: WarehouseIncidentView = JSON.parse(
    execFileSync("bun", ["-e", script], { encoding: "utf8" }),
  );
  const { report } = view;
  report.from = workload.window_start!;
  report.until = around;
  report.recorded_before = around;
  report.discovery_complete = true;
  const episode = report.incidents[0];
  episode.entry.title = "Checkout requests waited on an open transaction";
  Object.assign(episode.entry, {
    first_seen_at: before(126),
    last_seen_at: before(84),
    recorded_at: before(70),
    lifecycle: "resolved",
  });
  episode.display.database_name = "Checkout";
  episode.display.environment = "Production";
  episode.victim_summary =
    "Checkout writes waited for 42 seconds while a session held a lock on the orders table.";
  episode.mechanism =
    "The wait chain linked the checkout request to session 84. The owner was idle in an open transaction.";
  const waiter = episode.affected_queries[0];
  if (waiter.sql.state === "available")
    waiter.sql.text =
      "UPDATE checkout.orders SET status = @status WHERE id = @order_id";
  episode.candidate_queries = [];
  episode.culprit_queries[0].causal_role!.explanation.text =
    "Session 84 owned the blocking lock. Its earlier statement was outside the captured interval.";
  episode.developer_action =
    "Trace the transaction boundary in the payment worker and close the transaction before the network call.";
  episode.verification =
    "Repeat the checkout and compare lock waits in the next captured window.";
  view.analysis_limitations = [];
  return view;
}
const view = incidentScenario();
async function installScenario(page: Page) {
  await page.clock.setFixedTime(new Date(around));
  await page.route("**/api/archive/fleet", (route) => {
    const request = route.request().postDataJSON().request;
    return route.fulfill({
      json: {
        request,
        rows,
        summary: {
          evaluated_resources: rows.length,
          attention_resources: 4,
          active_incidents: 6,
          high_finding_resources: 3,
          regression_resources: 0,
          stale_or_partial_resources: 2,
        },
        next: null,
        discovery_complete: true,
        qualifications: [],
        gaps: [],
      },
    });
  });
  await page.route("**/api/archive/incident", (route) =>
    route.fulfill({ json: view }),
  );
  await page.route("**/api/archive/window", (route) => {
    const request: WarehouseWindowQuery = route
      .request()
      .postDataJSON().request;
    expect(request.view).toBe("compatible-workload");
    return route.fulfill({
      json: {
        request,
        discovery_complete: true,
        originals: [],
        qualifications: [],
        gaps: [],
        workload: {
          kind: "evaluated",
          analysis: {
            sections: [
              {
                analysis_id: "sample-query-store",
                scope_id: resource.namespace_id,
                native_scope_qualified: true,
                population: {
                  kind: "population",
                  identity: { id: workload.source, qualifiers: {} },
                },
                observed: request.window,
                analysis: {
                  runtime_totals: {
                    executions: String(workload.total_executions),
                    query_identities: String(workload.query_count),
                  },
                  workload,
                  limitations: [],
                },
                comparison: { changes: null, gaps: [] },
              },
            ],
            gaps: [],
          },
        },
      },
    });
  });
}
for (const theme of ["light", "dark"] as const) {
  test(
    "a DBA can investigate the sample estate in " + theme + " mode",
    async ({ page }, info) => {
      await installScenario(page);
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.setViewportSize({ width: 1440, height: 984 });
      const capture = async (name: string) => {
        await page.evaluate(() => document.fonts.ready);
        const dir =
          process.env.CULPRIT_WEB_SCREENSHOTS === "1"
            ? "docs/images"
            : info.outputDir;
        await mkdir(dir, { recursive: true });
        await page.screenshot({
          path: dir + "/" + name + "-" + theme + ".png",
          animations: "disabled",
        });
      };
      await page.goto("/");
      await page.getByRole("link", { name: "Company SSO" }).click();
      await page.getByRole("button", { name: "DBA", exact: true }).click();
      await expect(
        page.getByRole("link", { name: "Checkout", exact: true }),
      ).toBeVisible();
      await capture("fleet");
      await page.getByRole("link", { name: "Checkout", exact: true }).click();
      await expect(
        page.getByRole("heading", {
          name: view.report.incidents[0].entry.title,
        }),
      ).toBeVisible();
      await capture("investigation");
      await page.getByRole("link", { name: "Workload", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Top SQL" }),
      ).toBeVisible();
      await capture("workload");
      await page.locator(".workload td summary").first().click();
      await page
        .getByText("Captured execution plan", { exact: true })
        .first()
        .click();
      await expect(
        page.locator(".workload details[open] details[open] svg").first(),
      ).toBeVisible();
    },
  );
}
