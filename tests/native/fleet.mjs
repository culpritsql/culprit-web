import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

const browser = await chromium.launch();
const page = await browser.newPage({ baseURL: "http://127.0.0.1:4387" });
try {
  await page.goto("/?view=regions");
  await page.getByRole("link", { name: "Company SSO" }).click();
  await page.getByRole("button", { name: "Regional DBA", exact: true }).click();
  const europe = page.getByRole("article").filter({ hasText: "Europe" });
  const us = page.getByRole("article").filter({ hasText: "United States" });
  await us.locator("dd").first().waitFor({timeout:60000});
  await europe.locator("dd").first().waitFor({timeout:60000});
  assert.equal(await us.locator("dd").first().textContent(), "1");
  assert.equal(await europe.locator("dd").first().textContent(), "1");
  await europe.getByRole("link", { name: "Open fleet" }).click();
  await page.getByRole("link", { name: "db", exact: true }).click({ timeout: 60000 });
  await page.getByText("No recorded incidents in this window.").waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Published findings and changes" }).click();
  await page.getByText("No published analyses were returned on this page.").waitFor({ timeout: 60000 });
  const query = new URL(page.url()).searchParams;
  assert.equal(query.get("archive"), "restricted");
  assert.equal(query.get("around")?.slice(0, 10), "2020-01-01");
  console.log(
    "Published SQL Server resource opened through SSO, ClickHouse and S3 recovery. Raw-only input produced an empty incident window.",
  );
} catch (error) {
  console.error((await page.locator("main").innerText()).slice(0, 1500));
  throw error;
} finally {
  await browser.close();
}
