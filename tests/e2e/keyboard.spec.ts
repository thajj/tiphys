import { expect, test, type Locator, type Page } from "@playwright/test";
import { importSample, openEditor } from "./helpers";

async function tabTo(page: Page, target: Locator) {
  // Use the browser's sequential focus navigation, not programmatic focus on
  // the row: this also catches controls accidentally removed from the tab order.
  for (let index = 0; index < 60; index += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate(element => element === document.activeElement)) break;
  }
  await expect(target).toBeFocused();
}

test("opens workflow runs and templates using the keyboard", async ({ page }, testInfo) => {
  await openEditor(page, testInfo);
  const name = `keyboard-${testInfo.workerIndex}-${testInfo.retry}`;
  const seeded = await page.evaluate(async name => {
    const spec = {
      entrypoint: "hello",
      templates: [{ name: "hello", container: { image: "alpine:3.20", command: ["echo", "hello"] } }],
    };
    return Promise.all([
      ["workflows", "Workflow"],
      ["workflow-templates", "WorkflowTemplate"],
    ].map(async ([resource, kind]) => {
      const document = { apiVersion: "argoproj.io/v1alpha1", kind, metadata: { name, namespace: "workflows" }, spec };
      const response = await fetch(`/api/platform/${resource}/workflows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(resource === "workflows" ? { namespace: "workflows", workflow: document } : document),
      });
      return { status: response.status, body: await response.json() };
    }));
  }, name);
  expect(seeded.map(result => result.status)).toEqual([200, 200]);

  await page.getByTestId("platform-rail-item-workflows").click();
  const run = page.getByRole("button", { name: `Inspect workflow ${name}`, exact: true });
  await expect(run).toBeVisible();
  await page.getByRole("button", { name: "Refresh runs", exact: true }).focus();
  await tabTo(page, run);
  await page.keyboard.press("Enter");
  await expect(run).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("pre")).toContainText(`Hello from Tiphys: ${name}`);

  await page.getByRole("button", { name: "Templates", exact: true }).click();
  const template = page.getByRole("button", { name: `Select template ${name}`, exact: true });
  await expect(template).toBeVisible();
  await page.getByRole("button", { name: "New template", exact: true }).first().focus();
  await tabTo(page, template);
  await page.keyboard.press("Space");
  await expect(template).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(name);
  await expect(page.getByRole("button", { name: "Edit template", exact: true })).toBeVisible();
});

test("keeps connection deletion undoable and unavailable to a read-only identity", async ({ page }, testInfo) => {
  await openEditor(page, testInfo);
  await importSample(page, "keyboard-edge");
  const edges = page.locator(".react-flow__edge");
  await expect(edges).toHaveCount(4);
  await edges.first().focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Delete connection", exact: true }).click();
  await expect(edges).toHaveCount(3);
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  const saved = page.waitForResponse(async response => {
    if (!response.url().includes("/session/drafts/") || response.request().method() !== "PUT" || response.status() !== 200) return false;
    const draft = await response.json();
    return draft.sessions.some((session: any) => session.nodes.length === 4 && session.edges.length === 4);
  });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(edges).toHaveCount(4);
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  await saved;

  // Keep the identity and saved draft, but revoke editor membership.
  await page.setExtraHTTPHeaders({
    "X-Auth-Proxy-Secret": "e2e-proxy-proof-at-least-32-characters",
    "X-Auth-Request-User": `${testInfo.testId}:${testInfo.retry}`,
    "X-Auth-Request-Groups": "viewers",
  });
  await page.reload();
  await expect(page.getByText("Read-only mode", { exact: true })).toBeVisible();
  await expect(edges).toHaveCount(4);
  await edges.first().focus();
  await page.keyboard.press("Enter");
  await expect(edges.first()).toHaveClass(/selected/);
  await expect(page.getByRole("button", { name: "Delete connection", exact: true })).toHaveCount(0);
  await page.keyboard.press("Delete");
  await expect(edges).toHaveCount(4);
});

test("closed drawers leave keyboard focus in the visible interface", async ({ page }, testInfo) => {
  await openEditor(page, testInfo);
  await page.getByRole("button", { name: "Toggle inspector", exact: true }).click();
  const inspector = page.getByTestId("workflow-inspector-drawer");
  await expect(inspector).not.toHaveAttribute("inert");
  await inspector.getByRole("button", { name: "Close inspector", exact: true }).click();
  await expect(page.getByRole("button", { name: "Toggle inspector", exact: true })).toBeFocused();
  await expect(inspector).toHaveAttribute("inert", "");
  expect(await inspector.locator("button").first().evaluate(element => {
    element.focus();
    return document.activeElement === element;
  })).toBe(false);

  await page.getByRole("button", { name: "Toggle bottom panel", exact: true }).click();
  const bottom = page.getByTestId("workflow-bottom-drawer");
  await expect(bottom).not.toHaveAttribute("inert");
  await bottom.getByRole("button", { name: "Collapse panel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Toggle bottom panel", exact: true })).toBeFocused();
  await expect(bottom).toHaveAttribute("inert", "");
  expect(await bottom.locator("button").first().evaluate(element => {
    element.focus();
    return document.activeElement === element;
  })).toBe(false);
});

test("switching workflow tabs never carries an unapplied YAML draft into the next pipeline", async ({ page }, testInfo) => {
  await openEditor(page, testInfo);
  await importSample(page, "keyboard-yaml");
  await page.getByRole("button", { name: "Toggle inspector", exact: true }).click();
  await page.getByRole("button", { name: "YAML", exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.locator(".monaco-editor");
  await editor.locator("textarea.inputarea").focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("\n# unapplied-draft-from-first-workflow\n");
  await expect(editor.locator(".view-lines")).toContainText("unapplied-draft-from-first-workflow");

  await page.getByRole("button", { name: "New workflow", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await expect(editor.locator(".view-lines")).toContainText("new-workflow-2");
  await expect(editor.locator(".view-lines")).not.toContainText("unapplied-draft-from-first-workflow");
  await expect(page.getByRole("button", { name: "Apply to pipeline", exact: true })).toHaveCount(0);
  await expect(page.locator(".react-flow__node")).toHaveCount(0);
});
