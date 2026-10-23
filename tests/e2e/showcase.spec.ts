import { expect, test, type Locator, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { importSample, openEditor } from "./helpers";

const enabled = process.env.RUN_SHOWCASE === "1";
const appSize = { width: 1600, height: 904 };
type Point = { x: number; y: number };
type CameraFrame = { videoSeconds: number; zoom: number; centerX: number; centerY: number; durationSeconds: number };
test.use({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
  colorScheme: "dark",
  reducedMotion: "reduce",
  video: enabled ? { mode: "on", size: { width: 1600, height: 1000 } } : "off",
});

// Presentation elements exist only in this recording. App behavior, data, and
// responses come from the compiled gateway and the browser-test service fixtures.
async function installPresentation(page: Page) {
  await page.evaluate(() => {
    const overlay = document.createElement("div");
    overlay.id = "showcase-presentation";
    overlay.setAttribute("aria-hidden", "true");
    overlay.setAttribute("popover", "manual");
    overlay.innerHTML = `
      <style>
        /* Reserve presentation chrome so the captions never cover app controls. */
        #root { height:calc(100% - 96px) !important; min-height:0 !important; }
        #showcase-presentation { position:fixed; inset:0; width:100vw; height:100vh; margin:0; padding:0; border:0; background:transparent; z-index:2147483647; pointer-events:none; overflow:hidden; font-family:Inter,"Segoe UI",sans-serif; color:#f8fafc; }
        #showcase-badge { margin-top:5px; font-size:11px; font-weight:500; letter-spacing:.015em; color:#a8b6c9; white-space:nowrap; }
        #showcase-badge::before { content:""; display:inline-block; width:6px; height:6px; margin:0 8px 1px 0; border-radius:50%; background:#5ee6ed; }
        #showcase-footer { position:absolute; inset:auto 0 0; height:96px; display:flex; align-items:center; gap:20px; padding:16px 34px; background:rgba(8,15,28,.98); border-top:1px solid rgba(94,230,237,.24); box-shadow:0 -16px 35px rgba(4,9,20,.12); }
        #showcase-number { width:48px; height:48px; flex:none; display:grid; place-items:center; border:1px solid rgba(94,230,237,.5); border-radius:12px; color:#5ee6ed; font-size:22px; font-weight:700; font-variant-numeric:tabular-nums; }
        #showcase-copy { flex:1; min-width:0; }
        #showcase-title { font-size:28px; font-weight:650; line-height:1.2; letter-spacing:-.025em; }
        #showcase-description { margin-top:5px; font-size:18px; color:#bac8db; line-height:1.35; }
        #showcase-brand { text-align:right; padding-left:22px; border-left:1px solid #263348; }
        #showcase-brand strong { font-size:19px; letter-spacing:-.03em; }
        #showcase-progress { display:flex; justify-content:flex-end; gap:5px; margin-top:8px; }
        #showcase-progress span { height:3px; width:18px; border-radius:4px; background:#263348; transition:background .3s; }
        #showcase-progress span[data-active="true"] { background:#5ee6ed; }
        #showcase-cursor { position:absolute; left:0; top:0; width:22px; height:28px; opacity:0; transform:translate3d(1460px,780px,0); filter:drop-shadow(0 1px 3px rgba(0,0,0,.45)); transition:opacity .28s ease; will-change:transform; }
        #showcase-pointer { display:block; transform-origin:2px 2px; }
        #showcase-pulse { position:absolute; width:34px; height:34px; margin:-17px; border:1.5px solid rgba(255,255,255,.8); border-radius:50%; opacity:0; }
      </style>
      <div id="showcase-cursor" data-x="1460" data-y="780"><svg id="showcase-pointer" viewBox="0 0 24 30" width="22" height="28"><path d="M2 2L3 24L9 18L13 27L17 25L13 16L22 16Z" fill="#fff" stroke="#172033" stroke-width="1.25" stroke-linejoin="round"/></svg></div>
      <div id="showcase-pulse"></div>
      <div id="showcase-footer">
        <div id="showcase-number">01</div>
        <div id="showcase-copy"><div id="showcase-title"></div><div id="showcase-description"></div></div>
        <div id="showcase-brand"><strong>ArgoCanvas</strong><div id="showcase-badge">Sample services · Demo data</div><div id="showcase-progress">${Array.from({ length: 5 }, () => "<span></span>").join("")}</div></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.showPopover();
  });
}

async function raisePresentation(page: Page) {
  // Native modal dialogs enter the top layer. Keep recording-only captions and
  // the pointer above their backdrop without changing the app's modal behavior.
  await page.evaluate(() => {
    const overlay = document.getElementById("showcase-presentation")!;
    if (overlay.matches(":popover-open")) overlay.hidePopover();
    overlay.showPopover();
  });
}

async function movePointer(page: Page, point: Point) {
  await page.evaluate(async point => {
    const cursor = document.getElementById("showcase-cursor")!;
    window.clearTimeout(Number(cursor.dataset.idleTimer));
    cursor.style.opacity = "1";
    const start = { x: Number(cursor.dataset.x), y: Number(cursor.dataset.y) };
    const dx = point.x - start.x;
    const dy = point.y - start.y;
    const distance = Math.hypot(dx, dy);
    const duration = Math.min(850, Math.max(350, 320 + distance * .38));
    const bend = Math.min(44, distance * .08);
    const control = {
      x: (start.x + point.x) / 2 - dy / Math.max(distance, 1) * bend,
      y: (start.y + point.y) / 2 + dx / Math.max(distance, 1) * bend,
    };
    await new Promise<void>(resolve => {
      const started = performance.now();
      const animate = (now: number) => {
        const progress = Math.min(1, (now - started) / duration);
        const eased = progress < .5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
        const remaining = 1 - eased;
        const x = remaining ** 2 * start.x + 2 * remaining * eased * control.x + eased ** 2 * point.x;
        const y = remaining ** 2 * start.y + 2 * remaining * eased * control.y + eased ** 2 * point.y;
        cursor.style.transform = `translate3d(${x}px,${y}px,0)`;
        if (progress < 1) requestAnimationFrame(animate);
        else resolve();
      };
      requestAnimationFrame(animate);
    });
    cursor.dataset.x = String(point.x);
    cursor.dataset.y = String(point.y);
    cursor.dataset.idleTimer = String(window.setTimeout(() => { cursor.style.opacity = "0"; }, 1100));
  }, point);
}

test("records the feature showcase through the production gateway", async ({ page }, testInfo) => {
  test.skip(!enabled, "Opt-in documentation recording: RUN_SHOWCASE=1");
  test.setTimeout(120000);
  const recordingStarted = Date.now();
  const video = page.video();
  const errors: string[] = [];
  const chapters: Array<{ chapter: number; title: string; videoSeconds: number }> = [];
  const camera: CameraFrame[] = [];
  const readingHolds: Array<{ scene: string; startSeconds: number; endSeconds: number }> = [];
  let cameraState = { zoom: 1, centerX: appSize.width / 2, centerY: appSize.height / 2 };
  let trimStartSeconds = 0;
  let trimEndSeconds = 0;
  page.on("pageerror", error => errors.push(error.message));

  // Reading time begins after the camera settles, so tighter crops remain legible
  // at the README GIF's size. Keep these intervals in the export's QA metadata.
  const readFor = async (scene: string, milliseconds: number) => {
    const startSeconds = (Date.now() - recordingStarted) / 1000;
    await page.waitForTimeout(milliseconds);
    readingHolds.push({ scene, startSeconds, endSeconds: (Date.now() - recordingStarted) / 1000 });
  };

  // These are export cues only. The recorded app remains at its original scale.
  const frame = (zoom = 1, centerX = appSize.width / 2, centerY = appSize.height / 2, durationSeconds = .9) => {
    const halfWidth = appSize.width / zoom / 2;
    const halfHeight = appSize.height / zoom / 2;
    const next = {
      zoom,
      centerX: Math.max(halfWidth, Math.min(appSize.width - halfWidth, centerX)),
      centerY: Math.max(halfHeight, Math.min(appSize.height - halfHeight, centerY)),
    };
    if (camera.length && Object.keys(next).every(key => next[key as keyof typeof next] === cameraState[key as keyof typeof next])) return;
    cameraState = next;
    camera.push({ videoSeconds: (Date.now() - recordingStarted) / 1000, ...next, durationSeconds });
  };

  const pointAt = async (page: Page, target: Locator, click = false) => {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (!box) throw new Error("The showcase control has no visible bounds");
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    expect(point.y).toBeLessThan(appSize.height); // Captions must not obscure the action.
    const halfWidth = appSize.width / cameraState.zoom / 2;
    const halfHeight = appSize.height / cameraState.zoom / 2;
    if (cameraState.zoom > 1 && (Math.abs(point.x - cameraState.centerX) > halfWidth - 24
      || Math.abs(point.y - cameraState.centerY) > halfHeight - 24)) {
      frame();
      await page.waitForTimeout(900);
    }
    await movePointer(page, point);
    if (click) {
      await page.evaluate(point => {
        const pulse = document.getElementById("showcase-pulse")!;
        Object.assign(pulse.style, { left: `${point.x}px`, top: `${point.y}px` });
        pulse.animate([{ opacity: .55, transform: "scale(.45)" }, { opacity: 0, transform: "scale(1.45)" }], { duration: 450, easing: "ease-out" });
        document.getElementById("showcase-pointer")!.animate([
          { transform: "scale(1)" }, { transform: "scale(.87)", offset: .35 }, { transform: "scale(1)" },
        ], { duration: 220, easing: "ease-out" });
      }, point);
      await target.click();
      await page.waitForTimeout(160);
    }
  };

  const chapter = async (number: number, title: string, description: string) => {
    chapters.push({ chapter: number, title, videoSeconds: (Date.now() - recordingStarted) / 1000 });
    await page.evaluate(({ number, title, description }) => {
      document.getElementById("showcase-number")!.textContent = String(number).padStart(2, "0");
      document.getElementById("showcase-title")!.textContent = title;
      document.getElementById("showcase-description")!.textContent = description;
      document.querySelectorAll("#showcase-progress span").forEach((segment, index) => segment.setAttribute("data-active", String(index < number)));
    }, { number, title, description });
  };

  try {
    await openEditor(page, testInfo);
    await importSample(page, "showcase-pipeline");
    await page.evaluate(() => document.fonts.ready);
    await installPresentation(page);
    // Let the reserved footer resize the app before fitting the opening graph.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.getByRole("button", { name: "fit view", exact: true }).click();
    // Leave space above the first node for the floating canvas toolbar.
    await page.getByRole("button", { name: "zoom out", exact: true }).click();
    await expect.poll(async () => {
      const canvas = await page.locator(".react-flow").boundingBox();
      const nodes = await page.locator(".react-flow__node").all();
      if (!canvas || nodes.length !== 4) return false;
      const boxes = await Promise.all(nodes.map(node => node.boundingBox()));
      return boxes.every(box => box && box.y >= canvas.y + 55 && box.x >= canvas.x
        && box.x + box.width <= canvas.x + canvas.width
        && box.y + box.height <= canvas.y + canvas.height);
    }).toBe(true);

    await chapter(1, "Build visually. Keep the details.", "Connect steps, inspect dependencies, and configure each task.");
    await page.waitForTimeout(400);
    trimStartSeconds = (Date.now() - recordingStarted) / 1000;
    chapters[0].videoSeconds = trimStartSeconds;
    frame(1, 800, 452, 0);
    await page.waitForTimeout(2400);
    await pointAt(page, page.locator(".react-flow__node").filter({ hasText: "publish" }), true);
    await expect(page.locator('input[value="python:3.13-alpine"]')).toBeVisible();
    frame(1.8, 1300, 400);
    await page.waitForTimeout(900);
    await readFor("Node settings", 2500);

    await chapter(2, "See the manifest behind the graph.", "Review and edit Argo YAML with local schema validation.");
    await pointAt(page, page.getByRole("button", { name: "YAML", exact: true }), true);
    await expect(page.locator(".monaco-editor .view-lines")).toContainText("apiVersion:");
    await expect(page.getByText("0 errors", { exact: true })).toBeVisible();
    await pointAt(page, page.getByRole("button", { name: "Edit", exact: true }), true);
    frame(2, 1300, 370);
    await page.waitForTimeout(900);
    await readFor("YAML manifest", 4000);

    await chapter(3, "Turn an idea into a starting workflow.", "Describe the pipeline and bring the generated draft onto the canvas.");
    await pointAt(page, page.getByRole("button", { name: "AI Ask", exact: true }), true);
    const prompt = page.getByRole("textbox", { name: "Describe the workflow" });
    // The prompt and Generate button sit lower than the YAML editor's header.
    frame(2, 1300, 678);
    await page.waitForTimeout(900);
    await pointAt(page, prompt);
    await prompt.fill("Collect sample records, validate and transform them in parallel, then publish a summary. Use Python and a 120-second deadline.");
    await readFor("AI prompt", 4500);
    frame();
    await page.waitForTimeout(900);
    const generated = page.waitForResponse(response => response.url().endsWith("/ai/workflow/generate") && response.request().method() === "POST");
    await pointAt(page, page.getByRole("button", { name: "Generate Workflow", exact: true }), true);
    expect((await generated).status()).toBe(200);
    await expect(page.getByRole("dialog")).toContainText("AI Generated Workflow");
    await raisePresentation(page);
    await page.waitForTimeout(600);
    await pointAt(page, page.getByRole("button", { name: /Replace Current/ }), true);
    await expect(page.locator(".react-flow__node")).toHaveCount(4);
    await page.waitForTimeout(1300);

    await chapter(4, "Review before you run.", "Ask for feedback on dependencies, retries, and resource budgets.");
    const analyzed = page.waitForResponse(response => response.url().endsWith("/ai/workflow/analyze") && response.request().method() === "POST");
    await pointAt(page, page.getByRole("button", { name: "Analyze with AI", exact: true }), true);
    const analysis = await analyzed;
    expect(analysis.status()).toBe(200);
    await expect(page.getByRole("dialog")).toContainText((await analysis.json()).content);
    await raisePresentation(page);
    frame(1.8, 800, 350);
    await page.waitForTimeout(900);
    await readFor("Workflow analysis", 6000);
    frame();
    await page.waitForTimeout(900);
    await pointAt(page, page.getByRole("button", { name: "Close Report", exact: true }), true);

    await chapter(5, "Submit. Inspect. Follow the logs.", "Send the workflow through the gateway and inspect the returned run.");
    const submitted = page.waitForResponse(response => response.url().endsWith("/api/platform/workflows/workflows") && response.request().method() === "POST");
    await pointAt(page, page.getByRole("button", { name: "Run", exact: true }), true);
    const submission = await submitted;
    expect(submission.status()).toBe(200);
    const workflow = await submission.json();
    expect(workflow.kind).toBe("Workflow");
    await expect(page.getByText("Submitted", { exact: true }).first()).toBeVisible();
    await page.waitForTimeout(1400);
    await pointAt(page, page.getByRole("button", { name: "View runs", exact: true }), true);
    const workflowRow = page.getByTestId(`workflow-row-${workflow.metadata.name}`);
    await pointAt(page, workflowRow, true);
    await expect(page.locator("pre")).toContainText(`Hello from ArgoCanvas: ${workflow.metadata.name}`);
    const logBox = await page.locator("pre").boundingBox();
    if (!logBox) throw new Error("The workflow logs have no visible bounds");
    frame(2, logBox.x + logBox.width / 2, 275);
    await page.waitForTimeout(900);
    await readFor("Run status and logs", 4000);
    expect(errors).toEqual([]);
    trimEndSeconds = (Date.now() - recordingStarted) / 1000;
  } finally {
    trimEndSeconds ||= (Date.now() - recordingStarted) / 1000;
    const timingPath = testInfo.outputPath("showcase-timing.json");
    await writeFile(timingPath, JSON.stringify({
      timingBasis: "Seconds since test body began, immediately after the video page fixture was created; trim points are approximate.",
      startSeconds: trimStartSeconds, endSeconds: trimEndSeconds, durationSeconds: trimEndSeconds - trimStartSeconds, chapters,
      cameraCoordinateSpace: { width: appSize.width, height: appSize.height, origin: "top-left", units: "source pixels" },
      camera, readingHolds,
    }, null, 2));
    await testInfo.attach("showcase-timing.json", { path: timingPath, contentType: "application/json" });
    await page.close();
    if (video) await testInfo.attach("showcase.webm", { path: await video.path(), contentType: "video/webm" });
  }
});
