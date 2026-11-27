import { test, expect } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  test(
    "the local regional demo opens without credentials in " + theme + " mode",
    async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.setViewportSize({ width: 1440, height: 1080 });
      await page.clock.setFixedTime(new Date("2026-10-11T12:13:47Z"));
      await page.goto("http://127.0.0.1:4391/?view=regions");
      const cards = page.getByRole("article");
      await expect(cards).toHaveCount(3);
      await expect(cards.nth(2).locator("dd").first()).toHaveText("2");
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path:
          process.env.CULPRIT_WEB_SCREENSHOTS === "1"
            ? "docs/images/regions-" + theme + ".png"
            : info.outputPath("regions.png"),
      });
      await cards
        .filter({ hasText: "United States" })
        .getByRole("link")
        .click();
      await page.getByRole("link", { name: "Checkout", exact: true }).click();
      await expect(
        page.getByRole("heading", {
          name: "Checkout requests waited on an open transaction",
        }),
      ).toBeVisible();
      await page.getByRole("link", { name: "Workload", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Top SQL" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Archive", exact: true }).click();
      await page.getByRole("option", { name: /eu-production/ }).click();
      await page.getByRole("link", { name: "Checkout", exact: true }).click();
      await expect(page).toHaveURL(/\/archives\/eu-production\//);
      await expect(
        page.getByText("Checkout requests waited on an open transaction"),
      ).toHaveCount(0);
    },
  );
}
