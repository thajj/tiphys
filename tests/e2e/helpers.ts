import { expect, type Page, type TestInfo } from "@playwright/test";
import { readFile } from "node:fs/promises";

export async function openEditor(page: Page, testInfo: TestInfo) {
  await page.setExtraHTTPHeaders({
    "X-Auth-Proxy-Secret": "e2e-proxy-proof-at-least-32-characters",
    "X-Auth-Request-User": `${testInfo.testId}:${testInfo.retry}`,
    "X-Auth-Request-Groups": "editors",
  });
  await page.goto("/");
}

export async function importSample(page: Page, name = "hello-pipeline") {
  const source = (await readFile("examples/hello-workflow.yaml", "utf8")).replace("hello-pipeline-", `${name}-`);
  await page.evaluate(source => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text", source);
    window.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true }));
  }, source);
  await page.getByRole("button", { name: /Replace Current/ }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  await expect(page.locator(".react-flow__node").filter({ hasText: "publish" })).toBeVisible();
}
