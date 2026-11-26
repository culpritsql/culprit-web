import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

const browser = await chromium.launch();
const page = await browser.newPage({ baseURL: "http://127.0.0.1:4387" });
try {
  await page.goto("/");
  await page.getByRole("link", { name: "Company SSO" }).click();
  await page.getByRole("button", { name: "DBA", exact: true }).click();
  await page.getByRole("link", { name: "db", exact: true }).click({ timeout: 60000 });
  await page.getByText("No recorded incidents in this window.").waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Published findings and changes" }).click();
  await page.getByText("No published analyses were returned on this page.").waitFor({ timeout: 60000 });
  const query = new URL(page.url()).searchParams;
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
