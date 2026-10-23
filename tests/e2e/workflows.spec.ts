import { expect, test } from "@playwright/test";
import { importSample, openEditor } from "./helpers";

test("imports, persists, submits, inspects logs and deletes a workflow through the production gateway", async ({ page }, testInfo) => {
  await openEditor(page, testInfo);
  await importSample(page, `browser-run-${testInfo.retry}`);
  const saved = await page.waitForResponse(async response => {
    if (!response.url().includes("/session/drafts/") || response.request().method() !== "PUT" || response.status() !== 200) return false;
    const body = await response.json();
    return body.sessions.some((session: any) => session.nodes.length === 4 && session.name.startsWith("browser-run-"));
  });
  expect(saved.ok()).toBe(true);
  await page.reload();
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  const submitted = page.waitForResponse(response => response.url().endsWith("/api/platform/workflows/workflows") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  const response = await submitted;
  expect(response.status()).toBe(200);
  const workflow = await response.json();
  expect(workflow.kind).toBe("Workflow");
  expect(workflow.spec.templates.find((template: any) => template.name === "main").dag.tasks).toHaveLength(4);
  await expect(page.getByText("Submitted", { exact: true }).first()).toBeVisible();
  await expect(page.locator("pre")).toContainText(`[SUBMITTED] workflows/${workflow.metadata.name}`);
  await expect(page.locator("pre")).not.toContainText("simulation completed");
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  await page.getByTestId(`workflow-row-${workflow.metadata.name}`).click();
  await expect(page.locator("pre")).toContainText(`Hello from ArgoCanvas: ${workflow.metadata.name}`);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete run", exact: true }).click();
  await expect(page.getByTestId(`workflow-row-${workflow.metadata.name}`)).toHaveCount(0);
});

test("publishes, updates, runs and deletes a workflow template with the current Argo revision", async ({ page }, testInfo) => {
  await openEditor(page, testInfo);
  await importSample(page, `browser-template-${testInfo.retry}`);
  const created = page.waitForResponse(response => response.url().endsWith("/workflow-templates/workflows") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Publish template", exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(200);
  const template = await response.json();
  expect(template.kind).toBe("WorkflowTemplate");
  expect(template.metadata.resourceVersion).toBeTruthy();
  const updated = page.waitForResponse(response => response.url().endsWith(`/workflow-templates/workflows/${template.metadata.name}`) && response.request().method() === "PUT");
  await page.getByRole("button", { name: "Update template", exact: true }).click();
  const update = await updated;
  expect(update.status()).toBe(200);
  expect(update.request().postDataJSON().metadata.resourceVersion).toBe(template.metadata.resourceVersion);
  expect((await update.json()).metadata.resourceVersion).not.toBe(template.metadata.resourceVersion);
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page.getByRole("button", { name: `Select template ${template.metadata.name}`, exact: true }).click();
  const runResponse = page.waitForResponse(response => response.url().endsWith(`/workflow-templates/workflows/${template.metadata.name}/run`) && response.request().method() === "POST");
  await page.getByRole("complementary").filter({ hasText: "Template YAML" }).getByRole("button", { name: "Run", exact: true }).click();
  const run = await runResponse;
  expect(run.status()).toBe(200);
  expect((await run.json()).spec.workflowTemplateRef.name).toBe(template.metadata.name);
  // Running a template navigates to the resulting runs list.
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page.getByRole("button", { name: `Select template ${template.metadata.name}`, exact: true }).click();
  await page.getByRole("complementary").filter({ hasText: "Template YAML" }).getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete template", exact: true }).click();
  await expect(page.getByRole("button", { name: `Select template ${template.metadata.name}`, exact: true })).toHaveCount(0);
});

test("reports an Argo submission failure without claiming success", async ({ page }, testInfo) => {
  await openEditor(page, testInfo);
  await importSample(page, "reject-submission");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByText("Failed", { exact: true }).first()).toBeVisible();
  await expect(page.locator("pre")).toContainText("[ERROR]");
  await expect(page.getByText("Submitted", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Succeeded", { exact: true })).toHaveCount(0);
});
