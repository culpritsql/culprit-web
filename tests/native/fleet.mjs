import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

function archiveFromUrl(u) {
  const parsed = new URL(u);
  return (
    parsed.searchParams.get("archive") ||
    decodeURIComponent(parsed.pathname.split("/")[2] || "")
  );
}

const browser = await chromium.launch();
const page = await browser.newPage({ baseURL: "http://127.0.0.1:4387" });
try {
  await page.goto("/?view=regions");
  await page.getByRole("link", { name: "Company SSO" }).click();
  await page.getByRole("button", { name: "Regional DBA", exact: true }).click();
  const europe = page.getByRole("article").filter({ hasText: "Europe" });
  const us = page.getByRole("article").filter({ hasText: "United States" });
  const japan = page.getByRole("article").filter({ hasText: "Japan" });
  await japan.getByRole("alert").waitFor({ timeout: 60000 });
  assert.equal(await japan.locator("dd").count(), 0, "the ADX archive with no assertion reports missing data");
  await us.locator("dd").first().waitFor({ timeout: 60000 });
  const databases = await us.locator("dd").first().textContent();
  if (process.argv.includes("--published-azure")) {
    assert.match(databases, /^[1-9]/, "the published incident archive contains a database");
  } else {
    assert.equal(databases, "1");
  }
  if (process.argv.includes("--europe-offline")) {
    await europe.getByRole("alert").waitFor({ timeout: 90000 });
    assert.equal(await europe.locator("dd").count(), 0);
    await us.getByRole("link", { name: "Open fleet" }).click();
    const resource = page.locator("a.db-link").first();
    await resource.waitFor({ timeout: 60000 });
    const url = new URL(await resource.getAttribute("href"), page.url());
    assert.equal(archiveFromUrl(url), "production");
    console.log("Stopping both European stores left the US fleet readable in the same web process.");
  } else {
    await europe.locator("dd").first().waitFor({ timeout: 60000 });
    assert.equal(await europe.locator("dd").first().textContent(), "1");
    await europe.getByRole("link", { name: "Open fleet" }).click();
    await page.getByRole("link", { name: "db", exact: true }).click({ timeout: 60000 });
    await page.getByText("No recorded incidents in this window.").waitFor({ timeout: 60000 });
    await page.getByText("No published analyses were returned on this page.").waitFor({ timeout: 60000 });
    const parsedUrl = new URL(page.url());
    assert.equal(archiveFromUrl(parsedUrl), "restricted");
    assert.equal(parsedUrl.searchParams.get("around")?.slice(0, 10), "2020-01-01");
    console.log(
      "Published SQL Server resource opened through SSO, ClickHouse and S3 recovery. Raw-only input produced an empty incident window.",
    );
  }
} catch (error) {
  console.error((await page.locator("main").innerText()).slice(0, 1500));
  throw error;
} finally {
  await browser.close();
}
