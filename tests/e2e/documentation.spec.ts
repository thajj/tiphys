import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { importSample, openEditor } from "./helpers";

test.use({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, colorScheme: "dark", reducedMotion: "reduce" });

async function graphGeometry(page: Page) {
  const canvas = await page.locator(".react-flow").boundingBox();
  const drawer = page.getByTestId("workflow-inspector-drawer");
  const inspector = await drawer.getAttribute("aria-hidden") === "false" ? await drawer.boundingBox() : null;
  const boxes = await Promise.all((await page.locator(".react-flow__node").all()).map(node => node.boundingBox()));
  if (!canvas || !boxes.length || boxes.some(box => !box)) throw new Error("The graph has no measurable canvas or nodes");
  const nodes = boxes.filter(box => box !== null);
  return {
    // Reserve space for the library tabs, floating tools and execution controls.
    area: { left: canvas.x + 32, top: canvas.y + 80, right: (inspector?.x ?? canvas.x + canvas.width) - 76, bottom: canvas.y + canvas.height - 92 },
    nodes,
    bounds: { left: Math.min(...nodes.map(box => box.x)), top: Math.min(...nodes.map(box => box.y)), right: Math.max(...nodes.map(box => box.x + box.width)), bottom: Math.max(...nodes.map(box => box.y + box.height)) },
  };
}

async function frameGraph(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  // The inspector overlays the canvas, so React Flow's full-canvas fit alone
  // cannot keep the rightmost nodes visible. Use the actual zoom/pan controls.
  await page.getByRole("button", { name: "fit view", exact: true }).click();
  await page.waitForTimeout(350); // Let the inspector and fit animations settle.
  for (let step = 0; step < 12; step += 1) {
    const { area, bounds } = await graphGeometry(page);
    if (bounds.right - bounds.left <= area.right - area.left && bounds.bottom - bounds.top <= area.bottom - area.top) break;
    await page.getByRole("button", { name: "zoom out", exact: true }).click();
    await expect.poll(async () => {
      const next = (await graphGeometry(page)).bounds;
      return next.right - next.left;
    }).toBeLessThan(bounds.right - bounds.left - 1);
  }

  const { area, bounds } = await graphGeometry(page);
  const delta = { x: (area.left + area.right - bounds.left - bounds.right) / 2, y: (area.top + area.bottom - bounds.top - bounds.bottom) / 2 };
  if (Math.abs(delta.x) > 1 || Math.abs(delta.y) > 1) {
    const start = await page.evaluate(({ area, delta }) => {
      // Choose a blank pane point where the whole drag stays clear of controls.
      for (const yFraction of [.2, .8, .4, .6]) for (const xFraction of [.5, .75, .25]) {
        const point = { x: area.left + (area.right - area.left) * xFraction, y: area.top + (area.bottom - area.top) * yFraction };
        if (point.x + delta.x < area.left || point.x + delta.x > area.right || point.y + delta.y < area.top || point.y + delta.y > area.bottom) continue;
        if (document.elementFromPoint(point.x, point.y)?.classList.contains("react-flow__pane")) return point;
      }
      return null;
    }, { area, delta });
    expect(start, "A blank canvas point is available for panning").not.toBeNull();
    await page.mouse.move(start!.x, start!.y);
    await page.mouse.down();
    await page.mouse.move(start!.x + delta.x, start!.y + delta.y, { steps: 12 });
    await page.mouse.up();
  }
  await page.mouse.move(600, 24);
  await expect.poll(async () => {
    const { area, nodes } = await graphGeometry(page);
    return nodes.every(box => box.x >= area.left && box.y >= area.top && box.x + box.width <= area.right && box.y + box.height <= area.bottom);
  }).toBe(true);
}

async function capture(page: Page, testInfo: TestInfo, name: string, graph = true) {
  await page.evaluate(() => document.fonts.ready);
  if (graph) await frameGraph(page);
  const path = testInfo.outputPath(name);
  await page.screenshot({ path, animations: "disabled" });
  await testInfo.attach(name, { path, contentType: "image/png" });
  if (process.env.UPDATE_DOC_SCREENSHOTS === "1") {
    await mkdir("docs/images", { recursive: true });
    await page.screenshot({ path: `docs/images/${name}`, animations: "disabled" });
  }
}

test("captures the imported workflow canvas and local YAML inspector", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && /monaco|worker|validation|Content Security Policy/i.test(message.text())) errors.push(message.text());
  });
  await openEditor(page, testInfo);
  await expect(page.getByText("AI disabled", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Analyze with AI", exact: true })).toBeEnabled();
  await importSample(page);
  await page.getByRole("button", { name: "fit view", exact: true }).click();
  await page.locator(".react-flow__node").filter({ hasText: "publish" }).click();
  await expect(page.locator('input[value="python:3.13-alpine"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "AI Ask", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit with AI", exact: true })).toBeEnabled();
  await capture(page, testInfo, "workflow-builder.png");
  await page.getByRole("button", { name: "YAML", exact: true }).click();
  await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".monaco-editor .view-lines")).toContainText("apiVersion:");
  await expect.poll(async () => (await page.locator(".monaco-editor").first().boundingBox())?.height || 0).toBeGreaterThan(200);
  await expect(page.getByText("0 errors", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await capture(page, testInfo, "yaml-editor.png");
  expect(errors).toEqual([]);
  // Verify that the language worker actually validates content; a mounted
  // editor and its initial "0 errors" label alone do not prove it is working.
  await page.locator(".monaco-editor .view-lines").click({ position: { x: 100, y: 10 } });
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText("apiVersion: : invalid");
  await expect(page.getByText(/^[1-9]\d* errors$/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "Apply to pipeline", exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("demonstrates enabled AI generation and workflow analysis", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await openEditor(page, testInfo);
  await importSample(page);
  await page.getByRole("button", { name: "fit view", exact: true }).click();
  await page.locator(".react-flow__node").filter({ hasText: "publish" }).click();
  await page.getByRole("button", { name: "AI Ask", exact: true }).click();
  await page.getByRole("textbox", { name: "Describe the workflow" }).fill(
    "Create a four-step Python pipeline: collect sample records, validate and transform them in parallel, then publish a summary. Use a 120-second deadline and clean up completed runs after five minutes.",
  );
  await expect(page.getByRole("button", { name: "Generate Workflow", exact: true })).toBeEnabled();
  await capture(page, testInfo, "ai-assistant.png");
  const generated = page.waitForResponse(response => response.url().endsWith("/ai/workflow/generate") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Generate Workflow", exact: true }).click();
  expect((await generated).status()).toBe(200);
  await expect(page.getByRole("dialog")).toContainText("AI Generated Workflow");
  await page.getByRole("button", { name: /Replace Current/ }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  const analyzed = page.waitForResponse(response => response.url().endsWith("/ai/workflow/analyze") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Analyze with AI", exact: true }).click();
  const response = await analyzed;
  expect(response.status()).toBe(200);
  const { content } = await response.json();
  expect(content.length).toBeGreaterThan(100);
  await expect(page.getByRole("dialog")).toContainText(content);
  await page.getByRole("button", { name: "Close Report", exact: true }).click();
  await frameGraph(page);
  await page.locator(".react-flow__node").filter({ hasText: "publish" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Edit with AI", exact: true }).click();
  await page.getByPlaceholder(/^e.g. Change image/).fill("Add three retries with bounded backoff and explicit CPU and memory budgets.");
  const edited = page.waitForResponse(response => response.url().endsWith("/ai/workflow/edit-node") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Apply AI instruction", exact: true }).click();
  expect((await edited).status()).toBe(200);
  await expect(page.getByPlaceholder("Describe what this step does...")).toHaveValue("Retry transient failures with bounded backoff and explicit CPU and memory budgets.");
  expect(errors).toEqual([]);
});
