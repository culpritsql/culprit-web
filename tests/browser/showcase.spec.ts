import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { around, view, workload } from "../../demo/estate";

async function installScenario(page: Page) {
  const response = await page.request.get(
    "http://127.0.0.1:4391/api/archive/connections",
  );
  const [{ reference: connection }] = await response.json();
  await page.clock.setFixedTime(new Date(around));
  await page.route(
    /\/api\/archive\/(fleet|incident|window|artifacts)$/,
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      const data = { ...route.request().postDataJSON(), connection };
      const response = await page.request.post("http://127.0.0.1:4391" + path, {
        data,
      });
      await route.fulfill({ response });
    },
  );
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
      await page.locator(".statement-toggle").first().click();
      await expect(
        page.getByRole("heading", { name: "Recorded waits" }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Runtime by plan" }).first(),
      ).toBeVisible();
      await page
        .getByText("Captured execution plan", { exact: true })
        .first()
        .click();
      await expect(
        page.locator(".statement-detail details[open] svg").first(),
      ).toBeVisible();
      const chart = page
        .getByRole("slider", { name: "Selected interval" })
        .first();
      await chart.focus();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Shift+ArrowRight");
      const bucket = workload.timeline!;
      const selected = page
        .getByRole("link", { name: "Investigate interval" })
        .first();
      const target = new URL(
        (await selected.getAttribute("href"))!,
        page.url(),
      );
      expect(Date.parse(target.searchParams.get("from")!)).toBe(
        Date.parse(bucket.starts[1]),
      );
      expect(Date.parse(target.searchParams.get("until")!)).toBe(
        Date.parse(bucket.starts[3]),
      );
      expect(Date.parse(target.searchParams.get("asof")!)).toBe(
        Date.parse(around),
      );
      await selected.click();
      await page.getByRole("link", { name: "Collection coverage" }).click();
      await expect(page).toHaveURL(
        (url) =>
          url.searchParams.get("from") === target.searchParams.get("from") &&
          url.searchParams.get("asof") === target.searchParams.get("asof"),
      );
      await page.goBack();
      await expect(
        page.getByText("The demo contains one archived Top SQL report.", {
          exact: false,
        }),
      ).toBeVisible();
    },
  );
}
