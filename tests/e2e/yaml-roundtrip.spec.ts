import { expect, test, type Page } from "@playwright/test";
import { openEditor } from "./helpers";

// Kept short: Monaco only renders the lines that are visible.
const advancedManifest = (name: string) => `# nightly build, owned by the platform team
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  generateName: ${name}-
  namespace: workflows
spec:
  entrypoint: main
  onExit: cleanup
  templates:
    - name: main
      dag:
        tasks:
          - name: build
            template: build
            continueOn: { failed: true }
    - name: build
      podSpecPatch: '{"terminationGracePeriodSeconds": 5}'
      container:
        image: example/build:1.0
    - name: cleanup
      container:
        image: busybox
`;

// Tall enough for Monaco to render the whole manifest.
test.use({ viewport: { width: 1280, height: 1600 } });

async function pasteWorkflow(page: Page, source: string) {
  await page.evaluate(text => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text", text);
    window.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true }));
  }, source);
  await page.getByRole("button", { name: /Replace Current/ }).click();
}

async function expectManifestToShow(page: Page, fragments: string[]) {
  const yamlTab = page.getByRole("button", { name: "YAML", exact: true });
  // Selecting a node already opens the inspector; only toggle it when it is closed.
  if (!(await yamlTab.isVisible())) {
    await page.getByRole("button", { name: "Toggle inspector", exact: true }).click();
  }
  await yamlTab.click();
  const lines = page.locator(".monaco-editor .view-lines");
  for (const fragment of fragments) {
    await expect(lines).toContainText(fragment);
  }
}

test("keeps unmodeled fields of an imported manifest through a visual edit and a reload", async ({ page }, testInfo) => {
  await openEditor(page, testInfo);
  await pasteWorkflow(page, advancedManifest(`roundtrip-${testInfo.retry}`));
  await expect(page.locator(".react-flow__node")).toHaveCount(1);

  await page.locator(".react-flow__node").filter({ hasText: "build" }).click();
  await page.locator('input[value="example/build:1.0"]').fill("example/build:2.0");

  const preserved = ["# nightly build, owned by the platform team", "onExit: cleanup", "continueOn:", "podSpecPatch:", "example/build:2.0", "name: cleanup"];
  await expectManifestToShow(page, preserved);

  await page.reload();
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await expectManifestToShow(page, preserved);
});
