import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

const enabled = process.env.RUN_SHOWCASE === "1";
const appSize = { width: 1600, height: 904 };
const officialExampleUrl = "https://github.com/argoproj/argo-workflows/blob/main/examples/dag-diamond.yaml";
type Point = { x: number; y: number };
type CameraFrame = { videoSeconds: number; zoom: number; centerX: number; centerY: number; durationSeconds: number };
test.use({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
  colorScheme: "dark",
  reducedMotion: "no-preference",
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
        <div id="showcase-brand"><strong>Tiphys</strong><div id="showcase-badge">Sample services · Demo data</div><div id="showcase-progress">${Array.from({ length: 5 }, () => "<span></span>").join("")}</div></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.showPopover();
    // Chromium recordings omit the OS pointer. This presentation-only pointer
    // follows actual browser input, including native HTML drags and edge drags.
    const cursor = document.getElementById("showcase-cursor")!;
    const follow = (event: MouseEvent) => {
      cursor.style.opacity = "1";
      cursor.style.transform = `translate3d(${event.clientX}px,${event.clientY}px,0)`;
    };
    // Chromium does not include the operating system's HTML drag image in its
    // video. Mirror the actual dragged Library card as a presentation guide.
    let dragGuide: HTMLElement | null = null;
    document.addEventListener("dragstart", event => {
      const card = (event.target as Element).closest('#sidebar-panel [draggable="true"]');
      if (!card) return;
      dragGuide = card.cloneNode(true) as HTMLElement;
      dragGuide.removeAttribute("draggable");
      dragGuide.id = "showcase-drag-guide";
      // Theme variables are scoped to #root. Preserve the real card's computed
      // colors when moving its presentation clone into the top-layer overlay.
      const cardStyle = getComputedStyle(card);
      dragGuide.style.backgroundColor = cardStyle.backgroundColor;
      dragGuide.style.color = cardStyle.color;
      const originals = Array.from(card.querySelectorAll("*"));
      dragGuide.querySelectorAll("*").forEach((element, index) => {
        const sourceStyle = getComputedStyle(originals[index]);
        const style = (element as HTMLElement).style;
        style.color = sourceStyle.color;
        style.backgroundColor = sourceStyle.backgroundColor;
        style.borderColor = sourceStyle.borderColor;
      });
      Object.assign(dragGuide.style, { position: "absolute", left: "0", top: "0", width: "196px", opacity: ".95", border: "2px solid #5ee6ed", boxShadow: "0 10px 28px #0b122233", pointerEvents: "none", transform: `translate3d(${event.clientX + 16}px,${event.clientY + 16}px,0)` });
      overlay.appendChild(dragGuide);
    }, true);
    document.addEventListener("dragover", event => {
      if (dragGuide) dragGuide.style.transform = `translate3d(${event.clientX + 16}px,${event.clientY + 16}px,0)`;
    }, true);
    const clearDragGuide = () => { dragGuide?.remove(); dragGuide = null; };
    document.addEventListener("dragend", clearDragGuide, true);
    document.addEventListener("drop", clearDragGuide, true);
    document.addEventListener("mousemove", follow, true);
    document.addEventListener("dragover", follow, true);
    document.addEventListener("mousedown", event => {
      const pulse = document.getElementById("showcase-pulse")!;
      Object.assign(pulse.style, { left: `${event.clientX}px`, top: `${event.clientY}px` });
      pulse.animate([{ opacity: .55, transform: "scale(.45)" }, { opacity: 0, transform: "scale(1.45)" }], { duration: 450, easing: "ease-out" });
    }, true);
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

let pointer: Point = { x: 1460, y: 780 };

async function movePointer(page: Page, point: Point, milliseconds = 650) {
  const from = pointer;
  const steps = Math.max(12, Math.ceil(milliseconds / 25));
  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    const eased = progress * progress * (3 - 2 * progress);
    await page.mouse.move(from.x + (point.x - from.x) * eased, from.y + (point.y - from.y) * eased);
    await page.waitForTimeout(milliseconds / steps);
  }
  pointer = point;
}

async function center(target: Locator): Promise<Point> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("The showcase control has no visible bounds");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function drag(page: Page, from: Point, to: Point) {
  await movePointer(page, from);
  await page.mouse.down();
  // Two small movements start Chromium's native HTML drag before the paced path.
  await movePointer(page, { x: from.x + 8, y: from.y + 4 }, 120);
  await movePointer(page, to, 1200);
  await page.mouse.move(to.x, to.y); // Ensure a dragover at the final drop target.
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(350);
}

test("records the feature showcase through the production gateway", async ({ page }, testInfo) => {
  test.skip(!enabled, "Opt-in documentation recording: RUN_SHOWCASE=1");
  test.setTimeout(180000);
  const recordingStarted = Date.now();
  const video = page.video();
  const officialSource = await readFile("tests/e2e/fixtures/official-dag-diamond.yaml", "utf8");
  let copiedOfficialSource = false;
  let savedAuthoringDraft = false;
  let completed = false;
  const errors: string[] = [];
  const chapters: Array<{ chapter: number; title: string; videoSeconds: number }> = [];
  const camera: CameraFrame[] = [];
  const readingHolds: Array<{ scene: string; startSeconds: number; endSeconds: number }> = [];
  let cameraState = { zoom: 1, centerX: appSize.width / 2, centerY: appSize.height / 2 };
  let trimStartSeconds = 0;
  let trimEndSeconds = 0;
  page.on("pageerror", error => {
    if (new URL(page.url()).origin === new URL(testInfo.project.use.baseURL!).origin) errors.push(error.message);
  });
  page.on("response", async response => {
    if (!response.url().includes("/session/drafts/") || response.request().method() !== "PUT" || !response.ok()) return;
    const draft = await response.json();
    savedAuthoringDraft ||= draft.sessions.some((session: { nodes: Array<{ data: { label: string } }>; edges: unknown[] }) =>
      session.nodes.length === 3 && session.edges.length === 2 &&
      ["prepare", "check-api", "approve"].every(label => session.nodes.some(node => node.data.label === label)));
  });

  // Reading time begins after the camera settles, so tighter crops remain legible
  // at the embedded player size. Keep these intervals in the export's QA metadata.
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

  const pointAt = async (target: Locator, click = false) => {
    const point = await center(target);
    expect(point.y).toBeLessThan(appSize.height);
    const halfWidth = appSize.width / cameraState.zoom / 2;
    const halfHeight = appSize.height / cameraState.zoom / 2;
    if (cameraState.zoom > 1 && (Math.abs(point.x - cameraState.centerX) > halfWidth - 24
      || Math.abs(point.y - cameraState.centerY) > halfHeight - 24)) {
      frame();
      await page.waitForTimeout(900);
    }
    await movePointer(page, point);
    if (click) {
      await target.click();
      await page.waitForTimeout(180);
    }
  };

  const field = (label: string) => page.locator("#config-panel label")
    .filter({ hasText: new RegExp(`^${label}$`) }).locator("..").locator("input");
  const typeValue = async (target: Locator, value: string) => {
    await pointAt(target, true);
    await target.press("ControlOrMeta+A");
    if (value) await target.pressSequentially(value, { delay: 65 });
    else await target.press("Backspace");
    await target.press("Tab");
    await expect(target).toHaveValue(value);
  };
  const node = (label: string) => page.locator(".react-flow__node")
    .filter({ has: page.getByRole("heading", { name: label, exact: true }) });
  const closeInspector = async () => {
    await pointAt(page.getByRole("button", { name: "Toggle inspector", exact: true }), true);
    await expect(page.getByTestId("workflow-inspector-drawer")).toHaveAttribute("aria-hidden", "true");
    await page.waitForTimeout(350);
  };

  const clearCanvasSelection = async () => {
    const point = await page.evaluate(() => {
      const canvas = document.querySelector(".react-flow")!.getBoundingClientRect();
      for (const y of [canvas.bottom - 150, canvas.top + 100]) for (const x of [600, 800, 1000]) {
        if (document.elementFromPoint(x, y)?.classList.contains("react-flow__pane")) return { x, y };
      }
      return null;
    });
    expect(point, "A blank canvas point is available to clear selection").not.toBeNull();
    await movePointer(page, point!);
    await page.mouse.click(point!.x, point!.y);
  };
  const assertAttachedEdges = async () => {
    const errors = await page.evaluate(() => Array.from(document.querySelectorAll(".react-flow__edge")).map(edge => {
      const match = edge.getAttribute("aria-label")?.match(/^Edge from (.+) to (.+)$/);
      if (!match) throw new Error("The rendered edge is missing its source/target label");
      const path = edge.querySelector(".react-flow__edge-path") as SVGPathElement;
      const matrix = path.getScreenCTM();
      if (!matrix) throw new Error("The rendered edge has no screen transform");
      const anchor = (id: string, kind: string) => {
        const node = Array.from(document.querySelectorAll(".react-flow__node")).find(node => node.getAttribute("data-id") === id);
        const handle = node?.querySelector(`.react-flow__handle.${kind}`);
        if (!handle) throw new Error("The rendered edge has no handle");
        const box = handle.getBoundingClientRect();
        const side = ["left", "right", "top", "bottom"].find(side => handle.classList.contains(`react-flow__handle-${side}`));
        return { x: side === "left" ? box.left : side === "right" ? box.right : (box.left + box.right) / 2,
          y: side === "top" ? box.top : side === "bottom" ? box.bottom : (box.top + box.bottom) / 2 };
      };
      const start = path.getPointAtLength(0).matrixTransform(matrix);
      const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix);
      const source = anchor(match[1], "source");
      const target = anchor(match[2], "target");
      return Math.max(Math.hypot(start.x - source.x, start.y - source.y), Math.hypot(end.x - target.x, end.y - target.y));
    }));
    expect(errors.length).toBeGreaterThan(0);
    expect(Math.max(...errors), "Arrow endpoints stay attached to their handle dots").toBeLessThan(1);
  };

  const graphGeometry = async () => {
    const canvas = await page.locator(".react-flow").boundingBox();
    const drawer = page.getByTestId("workflow-inspector-drawer");
    const inspector = await drawer.getAttribute("aria-hidden") === "false" ? await drawer.boundingBox() : null;
    const libraryPanel = await page.locator("#sidebar-panel").isVisible() ? await page.locator("#sidebar-panel").boundingBox() : null;
    const boxes = await Promise.all((await page.locator(".react-flow__node").all()).map(item => item.boundingBox()));
    if (!canvas || !boxes.length || boxes.some(box => !box)) throw new Error("The graph has no measurable canvas or nodes");
    const nodes = boxes.filter(box => box !== null);
    const area = {
      left: libraryPanel ? libraryPanel.x + libraryPanel.width + 32 : canvas.x + 32,
      top: canvas.y + 80,
      right: (inspector?.x ?? canvas.x + canvas.width) - 76,
      bottom: canvas.y + canvas.height - 92,
    };
    const bounds = { left: Math.min(...nodes.map(box => box.x)), top: Math.min(...nodes.map(box => box.y)), right: Math.max(...nodes.map(box => box.x + box.width)), bottom: Math.max(...nodes.map(box => box.y + box.height)) };
    return { area, nodes, bounds };
  };
  const frameGraph = async () => {
    await page.waitForTimeout(850); // Wait for the app's layout/fit transition.
    for (let step = 0; step < 12; step += 1) {
      const { area, bounds, nodes } = await graphGeometry();
      if (bounds.right - bounds.left <= area.right - area.left && bounds.bottom - bounds.top <= area.bottom - area.top && Math.max(...nodes.map(box => box.width)) <= 300) break;
      await pointAt(page.getByRole("button", { name: "zoom out", exact: true }), true);
      await page.waitForTimeout(300);
    }
    const { area, bounds } = await graphGeometry();
    const delta = { x: (area.left + area.right - bounds.left - bounds.right) / 2, y: (area.top + area.bottom - bounds.top - bounds.bottom) / 2 };
    if (Math.abs(delta.x) > 1 || Math.abs(delta.y) > 1) {
      const start = await page.evaluate(({ area, delta }) => {
        for (const fy of [.2, .8, .4, .6]) for (const fx of [.5, .75, .25]) {
          const point = { x: area.left + (area.right - area.left) * fx, y: area.top + (area.bottom - area.top) * fy };
          if (point.x + delta.x < area.left || point.x + delta.x > area.right || point.y + delta.y < area.top || point.y + delta.y > area.bottom) continue;
          if (document.elementFromPoint(point.x, point.y)?.classList.contains("react-flow__pane")) return point;
        }
        return null;
      }, { area, delta });
      expect(start, "A blank canvas point is available for panning").not.toBeNull();
      await drag(page, start!, { x: start!.x + delta.x, y: start!.y + delta.y });
    }
    await expect.poll(async () => {
      const { area, nodes } = await graphGeometry();
      return nodes.every(box => box.x >= area.left - 1 && box.y >= area.top - 1 && box.x + box.width <= area.right + 1 && box.y + box.height <= area.bottom + 1);
    }, { message: "Every node remains visible beside the Library and inspector" }).toBe(true);
    if (await page.locator(".react-flow__edge").count()) await assertAttachedEdges();
  };

  const chapter = async (number: number, title: string, description: string) => {
    if (chapters.at(-1)?.chapter !== number) chapters.push({ chapter: number, title, videoSeconds: (Date.now() - recordingStarted) / 1000 });
    await page.evaluate(({ number, title, description }) => {
      document.getElementById("showcase-number")!.textContent = String(number).padStart(2, "0");
      document.getElementById("showcase-title")!.textContent = title;
      document.getElementById("showcase-description")!.textContent = description;
      document.querySelectorAll("#showcase-progress span").forEach((segment, index) => segment.setAttribute("data-active", String(index < number)));
    }, { number, title, description });
  };

  try {
    // These dummy credentials are scoped to the local app, never sent to GitHub.
    const localOrigin = new URL(testInfo.project.use.baseURL!).origin;
    await page.context().setExtraHTTPHeaders({});
    await page.setExtraHTTPHeaders({});
    await page.route(`${localOrigin}/**`, route => route.continue({ headers: {
      ...route.request().headers(),
      "X-Auth-Proxy-Secret": "e2e-proxy-proof-at-least-32-characters",
      "X-Auth-Request-User": `${testInfo.testId}:${testInfo.retry}`,
      "X-Auth-Request-Groups": "editors",
    } }));
    await page.goto("/");
    await expect(page.getByRole("button", { name: "New workflow", exact: true })).toBeVisible();
    await expect(page.locator(".react-flow__node")).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    await installPresentation(page);
    const library = page.getByRole("button", { name: "Library", exact: true });
    if (!await page.locator("#sidebar-panel").isVisible()) await library.click();
    await expect(page.locator('#sidebar-panel [draggable="true"]').filter({ has: page.getByText("Container", { exact: true }) })).toBeVisible();

    // React Flow fits its first node at 2× on an empty canvas. Prepare a useful
    // working zoom through real controls, then remove this disposable setup node
    // before the exported recording begins. Subsequent drops retain this view.
    const containerCard = page.locator('#sidebar-panel [draggable="true"]').filter({ has: page.getByText("Container", { exact: true }) });
    await drag(page, await center(containerCard), { x: 400, y: 350 });
    await expect(page.locator(".react-flow__node")).toHaveCount(1);
    await closeInspector();
    await page.waitForTimeout(900);
    while ((await node("Container").boundingBox())!.width > 230) {
      await pointAt(page.getByRole("button", { name: "zoom out", exact: true }), true);
      await page.waitForTimeout(300);
    }
    await pointAt(node("Container"), true);
    await node("Container").focus();
    await page.keyboard.press("Backspace");
    await expect(page.locator(".react-flow__node")).toHaveCount(0);
    if (await page.getByTestId("workflow-inspector-drawer").getAttribute("aria-hidden") === "false") await closeInspector();
    await page.waitForTimeout(400);

    await chapter(1, "Drag components onto the canvas", "Start with an empty workflow. Add the steps you need from Library.");
    await page.waitForTimeout(400);
    trimStartSeconds = (Date.now() - recordingStarted) / 1000;
    chapters[0].videoSeconds = trimStartSeconds;
    frame(1, 800, 452, 0);
    await readFor("Empty canvas and component library", 2000);
    for (const [index, [label, point]] of ([
      ["Container", { x: 400, y: 350 }],
      ["HTTP Request", { x: 710, y: 400 }],
      ["Suspend", { x: 1020, y: 450 }],
    ] as const).entries()) {
      const card = page.locator('#sidebar-panel [draggable="true"]').filter({ has: page.getByText(label, { exact: true }) });
      await drag(page, await center(card), point);
      await expect(page.locator(".react-flow__node")).toHaveCount(index + 1);
      await closeInspector();
      await page.waitForTimeout(500);
    }
    await readFor("Three steps added from Library", 1800);

    await chapter(2, "Configure each step", "Set a container image, an HTTP request, and a manual approval.");
    await pointAt(node("Container"), true);
    await expect(field("Step Name")).toHaveValue("Container");
    frame(1.55, 1250, 430);
    await page.waitForTimeout(900);
    await typeValue(field("Step Name"), "prepare");
    await typeValue(page.getByPlaceholder("e.g. alpine:latest", { exact: true }), "busybox:1.37");
    await expect(page.locator("#config-panel .monaco-editor .view-lines")).toContainText("echo hello");
    await readFor("Container settings", 1800);
    frame();
    await page.waitForTimeout(900);
    await closeInspector();

    await pointAt(node("HTTP Req"), true);
    await expect(field("Step Name")).toHaveValue("HTTP Req");
    frame(1.55, 1250, 430);
    await page.waitForTimeout(900);
    await typeValue(field("Step Name"), "check-api");
    await typeValue(page.getByPlaceholder("https://api...", { exact: true }), "https://example.com");
    await expect(page.locator("#config-panel select")).toHaveValue("GET");
    await readFor("HTTP method and URL", 1800);
    frame();
    await page.waitForTimeout(900);
    await closeInspector();

    await pointAt(node("Pause"), true);
    await expect(field("Step Name")).toHaveValue("Pause");
    frame(1.55, 1250, 430);
    await page.waitForTimeout(900);
    await typeValue(field("Step Name"), "approve");
    await typeValue(page.getByPlaceholder("60s", { exact: true }), "");
    await expect(node("approve")).toContainText("Forever");
    await readFor("Manual approval has no time limit", 1600);
    frame();
    await page.waitForTimeout(900);
    await closeInspector();

    await clearCanvasSelection();
    await chapter(3, "Draw the dependencies", "Connect output dots to input dots, then arrange the workflow.");
    for (const [index, [from, to]] of [["prepare", "check-api"], ["check-api", "approve"]].entries()) {
      await drag(page, await center(node(from).locator(".react-flow__handle.source")), await center(node(to).locator(".react-flow__handle.target")));
      await expect(page.locator(".react-flow__edge")).toHaveCount(index + 1);
      await page.waitForTimeout(650);
    }
    await pointAt(page.getByRole("button", { name: "Auto-arrange layout", exact: true }), true);
    await frameGraph();
    await page.screenshot({ path: testInfo.outputPath("connected-workflow.png") });
    await readFor("Connected horizontal workflow", 1800);
    await pointAt(page.getByRole("button", { name: "Toggle layout direction", exact: true }), true);
    await frameGraph();
    await readFor("Connected vertical workflow", 2000);
    await pointAt(node("prepare"), true);
    await pointAt(page.getByRole("button", { name: "YAML", exact: true }), true);
    await expect(page.locator(".monaco-editor .view-lines")).toContainText("busybox:1.37");
    await expect(page.getByText("0 errors", { exact: true })).toBeVisible();
    await frameGraph();
    frame(1.55, 1250, 430);
    await page.waitForTimeout(900);
    await readFor("Generated Argo YAML", 3000);
    frame();
    await page.waitForTimeout(900);
    await expect.poll(() => savedAuthoringDraft, { message: "The authored workflow was saved before leaving the app" }).toBe(true);

    await chapter(4, "Copy an official Argo example", "Open dag-diamond.yaml in the Argo Workflows repository.");
    await page.waitForTimeout(1200);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://github.com" });
    await page.goto(officialExampleUrl, { waitUntil: "domcontentloaded" });
    const copyRaw = page.getByRole("button", { name: "Copy raw file", exact: true });
    await expect(copyRaw).toBeVisible({ timeout: 30000 });
    await installPresentation(page);
    await chapter(4, "Copy an official Argo example", "github.com/argoproj/argo-workflows · examples/dag-diamond.yaml");
    frame();
    await readFor("Official Argo source", 2000);
    await pointAt(copyRaw, true);
    const normalize = (value: string) => value.replace(/\r\n/g, "\n").trim();
    await expect.poll(async () => normalize(await page.evaluate(() => navigator.clipboard.readText())), { message: "GitHub Copy raw file places the official YAML on the clipboard", timeout: 15000 }).toBe(normalize(officialSource));
    copiedOfficialSource = true;
    await readFor("Official YAML copied", 1200);

    await page.goto("/");
    await expect(page.locator(".react-flow__node")).toHaveCount(3);
    await expect(page.locator(".react-flow__edge")).toHaveCount(2);
    await installPresentation(page);
    await chapter(5, "Paste and keep working", "Paste the YAML onto the canvas. Open it in a new tab to keep your first draft.");
    frame();
    // The source clipboard survives navigation. Paste through the browser's
    // real keyboard shortcut; no synthetic ClipboardEvent or graph injection.
    await movePointer(page, { x: 800, y: 700 });
    await page.mouse.click(800, 700);
    await page.keyboard.press("ControlOrMeta+V");
    await expect(page.getByRole("dialog")).toContainText("pasted-workflow.yaml");
    await raisePresentation(page);
    await readFor("YAML import choice", 1800);
    await pointAt(page.getByRole("button", { name: /^Open in New Tab/ }), true);
    await expect(page.locator(".react-flow__node")).toHaveCount(4);
    await expect(page.locator(".react-flow__edge")).toHaveCount(4);
    for (const label of ["A", "B", "C", "D"]) await expect(node(label)).toBeVisible();
    await pointAt(page.getByRole("button", { name: "Toggle layout direction", exact: true }), true);
    await frameGraph();
    await readFor("Imported diamond workflow", 2500);
    await pointAt(node("A"), true);
    await pointAt(page.getByRole("button", { name: "YAML", exact: true }), true);
    await expect(page.locator(".monaco-editor .view-lines")).toContainText("diamond");
    await expect(page.getByText("0 errors", { exact: true })).toBeVisible();
    await frameGraph();
    await page.screenshot({ path: testInfo.outputPath("imported-graph-yaml.png") });
    await readFor("Imported graph and generated YAML", 3500);
    expect(errors).toEqual([]);
    trimEndSeconds = (Date.now() - recordingStarted) / 1000;
    completed = true;

  } finally {
    if (!completed && !page.isClosed()) await page.screenshot({ path: testInfo.outputPath("incomplete-showcase.png") }).catch(() => {});
    trimEndSeconds ||= (Date.now() - recordingStarted) / 1000;
    const timingPath = testInfo.outputPath("showcase-timing.json");
    await writeFile(timingPath, JSON.stringify({
      timingBasis: "Seconds since test body began, immediately after the video page fixture was created; trim points are approximate.",
      startSeconds: trimStartSeconds, endSeconds: trimEndSeconds, durationSeconds: trimEndSeconds - trimStartSeconds, chapters,
      cameraCoordinateSpace: { width: appSize.width, height: appSize.height, origin: "top-left", units: "source pixels" },
      camera, readingHolds, completed,
      capture: { kind: "continuous-browser-video", nativeFrameRate: 25, reducedMotion: "no-preference", actions: "Native mouse drag, paced typing, GitHub Copy raw file, and keyboard paste" },
      source: { url: officialExampleUrl, fixture: "tests/e2e/fixtures/official-dag-diamond.yaml", copiedAndVerified: copiedOfficialSource },
    }, null, 2));
    await testInfo.attach("showcase-timing.json", { path: timingPath, contentType: "application/json" });
    await page.close();
    if (video) await testInfo.attach("showcase.webm", { path: await video.path(), contentType: "video/webm" });
  }
});
