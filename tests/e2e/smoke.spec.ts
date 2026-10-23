import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }, testInfo) => {
  await page.setExtraHTTPHeaders({
    "X-Auth-Proxy-Secret": "e2e-proxy-proof-at-least-32-characters",
    "X-Auth-Request-User": `${testInfo.testId}:${testInfo.retry}`,
    "X-Auth-Request-Groups": "editors",
  });
});

test("loads the workflow builder route", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dry run", exact: true })).toBeVisible();

  const layoutMetrics = await page.evaluate(() => ({
    viewportHeight: window.innerHeight,
    documentHeight: document.documentElement.scrollHeight,
    bodyHeight: document.body.scrollHeight,
  }));

  expect(layoutMetrics.documentHeight).toBeLessThanOrEqual(layoutMetrics.viewportHeight + 1);
  expect(layoutMetrics.bodyHeight).toBeLessThanOrEqual(layoutMetrics.viewportHeight + 1);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("production-app.png") });
});

test("loads the local YAML editor without a CDN or CSP failures", async ({ page }) => {
  const violations: string[] = [];
  await page.addInitScript(() => {
    (window as any).__cspViolations = [];
    document.addEventListener("securitypolicyviolation", event => (window as any).__cspViolations.push(event.blockedURI));
  });
  page.on("request", request => { if (!request.url().startsWith("https://127.0.0.1:3000") && !request.url().startsWith("blob:")) violations.push(request.url()); });
  await page.goto("/");
  await page.getByRole("button", { name: "Toggle inspector", exact: true }).click();
  await page.getByRole("button", { name: "YAML", exact: true }).click();
  await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 30000 });
  expect(violations).toEqual([]);
  expect(await page.evaluate(() => (window as any).__cspViolations)).toEqual([]);
});

test("read-only identity cannot submit workflows", async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, extraHTTPHeaders: {
    "X-Auth-Proxy-Secret": "e2e-proxy-proof-at-least-32-characters", "X-Auth-Request-User": "browser-viewer", "X-Auth-Request-Groups": "viewers",
  } });
  const page = await context.newPage();
  await page.goto("https://127.0.0.1:3000");
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeDisabled();
  expect((await context.request.post("https://127.0.0.1:3000/api/platform/workflows/workflows", { data: {} })).status()).toBe(403);
  expect((await context.request.post("https://127.0.0.1:3000/api/platform/ai/workflow/generate", { data: { description: "An echo workflow" } })).status()).toBe(403);
  await context.close();
});

test("unauthenticated requests are rejected by the built gateway", async ({ playwright }) => {
  const request = await playwright.request.newContext({ ignoreHTTPSErrors: true, extraHTTPHeaders: {} });
  expect((await request.get("https://127.0.0.1:3000/api/platform/config")).status()).toBe(401);
  await request.dispose();
});

test("confirms browser autosave persists a draft through the HTTPS gateway", async ({ page }, testInfo) => {
  const saved = page.waitForResponse(response => response.url().includes("/session/drafts/") && response.request().method() === "PUT" && response.status() === 200);
  await page.goto("/");
  const response = await saved;
  const document = await response.json();
  expect(document.sessions.length).toBeGreaterThan(0);
  const restored = await page.request.get(response.url(), { headers: { "X-Auth-Request-User": `${testInfo.testId}:${testInfo.retry}` } });
  expect(restored.ok()).toBe(true);
  expect((await restored.json()).activeSessionId).toBe(document.activeSessionId);
});
