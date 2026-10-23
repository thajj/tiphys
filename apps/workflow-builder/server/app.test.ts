// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createProductionServer } from "./app";
import { loadServerConfig, type ServerConfig } from "./config";

const secret = "test-proxy-secret-at-least-32-characters";
const headers = { "x-auth-proxy-secret": secret, "x-auth-request-user": "alice", "x-auth-request-groups": "editors", Origin: "https://builder.example", "Content-Type": "application/json" };
const workflow = { apiVersion: "argoproj.io/v1alpha1", kind: "Workflow", metadata: { generateName: "hello-", namespace: "workflows" }, spec: { entrypoint: "main", templates: [] } };
const draft = { sessions: [], activeSessionId: null, savedAt: 123 };
const listen = async (server: Server) => {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

describe("production gateway", () => {
  let directory: string;
  let argo: Server;
  let app: Awaited<ReturnType<typeof createProductionServer>>;
  let config: ServerConfig;
  let base: string;
  let upstreamStatus = 200;
  let upstreamBody: unknown = { items: [], metadata: {} };
  let upstreamReply: ((url: string) => unknown) | undefined;
  let upstreamPause: Promise<void> | undefined;
  let requests: { url: string; method: string; auth: string; body: any }[];
  const request = (url: string, init: RequestInit = {}) => fetch(`${base}${url}`, { ...init, headers: { ...headers, ...init.headers } });
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "argo-gateway-test-"));
    await mkdir(path.join(directory, "public", "assets"), { recursive: true });
    await writeFile(path.join(directory, "public", "index.html"), "<html>workflow builder</html>");
    await writeFile(path.join(directory, "public", "assets", "main-hash.js"), "console.log('ok')");
    upstreamStatus = 200; upstreamBody = { items: [], metadata: {} }; upstreamReply = undefined; upstreamPause = undefined; requests = [];
    argo = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      requests.push({ url: req.url!, method: req.method!, auth: String(req.headers.authorization), body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined });
      await upstreamPause;
      res.writeHead(upstreamStatus, { "Content-Type": "application/json" });
      res.end(JSON.stringify(upstreamReply ? upstreamReply(req.url!) : upstreamBody));
    });
    config = loadServerConfig({ PUBLIC_URL: "https://builder.example", ARGO_ENDPOINT: await listen(argo), ARGO_NAMESPACE: "workflows", ARGO_TOKEN: "server-token", AUTH_PROXY_SECRET: secret, AUTH_EDITOR_GROUPS: "editors", DATA_DIR: path.join(directory, "data"), STATIC_DIR: path.join(directory, "public") });
    app = await createProductionServer(config); base = await listen(app.server);
  });
  afterEach(async () => {
    await app?.close();
    await new Promise<void>(resolve => argo.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  it("requires proxy proof and user identity for HTML, configuration, and API routes", async () => {
    for (const url of ["/", "/api/platform/config", "/api/platform/workflows/workflows"]) {
      expect((await fetch(`${base}${url}`)).status).toBe(401);
      expect((await request(url, { headers: { "x-auth-proxy-secret": "wrong" } })).status).toBe(401);
      expect((await request(url, { headers: { "x-auth-request-user": "" } })).status).toBe(401);
    }
    expect(requests).toHaveLength(0);
  });
  it("derives runtime scope and permissions without exposing credentials", async () => {
    const response = await request("/api/platform/config", { headers: { "x-auth-request-groups": "viewers" } });
    const body = await response.json();
    expect(body.namespaceScope).toBe("workflows");
    expect(body.permissions.canSubmitWorkflow).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/server-token|test-proxy-secret/);
  });
  it("denies viewer writes and cross-site writes before reaching Argo", async () => {
    for (const extra of [{ "x-auth-request-groups": "viewers" }, { Origin: "https://evil.example" }, { Origin: "" }, { "sec-fetch-site": "cross-site" }]) {
      expect((await request("/api/platform/workflows/workflows", { method: "POST", body: JSON.stringify({ workflow }), headers: extra })).status).toBe(403);
    }
    expect(requests).toHaveLength(0);
  });
  it("rejects namespaces in the URL and body outside its scope", async () => {
    expect((await request("/api/platform/workflows/kube-system")).status).toBe(403);
    expect((await request("/api/platform/workflows/workflows", { method: "POST", body: JSON.stringify({ workflow: { ...workflow, metadata: { ...workflow.metadata, namespace: "kube-system" } } }) })).status).toBe(403);
    expect((await request("/api/platform/workflows/workflows/hello%2F..%2Fother")).status).toBe(400);
    expect(requests).toHaveLength(0);
  });
  it("proxies a real workflow submission with server-only credentials", async () => {
    upstreamBody = { ...workflow, metadata: { name: "hello-123" } };
    const response = await request("/api/platform/workflows/workflows", { method: "POST", body: JSON.stringify({ workflow }) });
    expect(response.status).toBe(200);
    expect((await response.json()).metadata.name).toBe("hello-123");
    expect(requests[0]).toMatchObject({ method: "POST", auth: "Bearer server-token", url: "/api/v1/workflows/workflows", body: { namespace: "workflows", workflow } });
  });
  it("uses Argo template persistence and the correct submission envelope", async () => {
    const template = { ...workflow, kind: "WorkflowTemplate", metadata: { name: "example" } };
    expect((await request("/api/platform/workflow-templates/workflows", { method: "POST", body: JSON.stringify(template) })).status).toBe(200);
    expect(requests[0].body.template.kind).toBe("WorkflowTemplate");
    expect((await request("/api/platform/workflow-templates/workflows/example/run", { method: "POST", body: "{}" })).status).toBe(200);
    expect(requests[1].body).toMatchObject({ namespace: "workflows", workflow: { spec: { workflowTemplateRef: { name: "example" } } } });
  });
  it("preserves upstream denial and never invents successful operations", async () => {
    upstreamStatus = 403; upstreamBody = { message: "sensitive upstream details" };
    let response = await request("/api/platform/workflows/workflows", { method: "POST", body: JSON.stringify({ workflow }) });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("sensitive upstream");
    await new Promise<void>(resolve => argo.close(() => resolve()));
    response = await request("/api/platform/workflows/workflows", { method: "POST", body: JSON.stringify({ workflow }) });
    expect(response.status).toBe(502);
    expect((await request("/api/platform/workflows/workflows/missing", { method: "DELETE" })).status).toBe(502);
  });
  it("validates JSON, content type, resource shape, and size", async () => {
    const url = "/api/platform/workflows/workflows";
    expect((await request(url, { method: "POST", body: "{broken" })).status).toBe(400);
    expect((await request(url, { method: "POST", body: "{}", headers: { "Content-Type": "text/plain" } })).status).toBe(415);
    expect((await request(url, { method: "POST", body: "{}" })).status).toBe(400);
    expect((await request(url, { method: "POST", body: JSON.stringify({ value: "x".repeat(6 * 1024 * 1024) }) })).status).toBe(413);
    expect(requests).toHaveLength(0);
  });
  it("persists drafts across restarts and isolates users", async () => {
    const url = "/api/platform/session/drafts/workspace/project";
    expect((await request(url, { method: "PUT", body: JSON.stringify(draft) })).status).toBe(200);
    await app.close(); app = await createProductionServer(config); base = await listen(app.server);
    expect(await (await request(url)).json()).toEqual(draft);
    expect((await request(url, { headers: { "x-auth-request-user": "bob" } })).status).toBe(404);
  });
  it("keeps health separate from readiness and reports upstream failure", async () => {
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/readyz`)).status).toBe(200);
    upstreamStatus = 503;
    expect((await fetch(`${base}/readyz`)).status).toBe(503);
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
  });
  it("serves browser routes safely and never responds to missing API routes with HTML", async () => {
    const response = await request("/pipelines");
    expect(await response.text()).toContain("workflow builder");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await request("/assets/missing.js")).status).toBe(404);
    expect((await request("/.env")).status).toBe(404);
    expect((await request("/api/platform/missing")).status).toBe(404);
    expect((await request("/api/platform/sensors/workflows")).status).toBe(404);
    expect((await request("/assets/main-hash.js")).headers.get("cache-control")).toContain("immutable");
  });
  it("translates workflow filters and rejects unbounded requests", async () => {
    expect((await request("/api/platform/workflows/workflows?limit=50&phases=Running,Failed&cursor=abc")).status).toBe(200);
    expect(requests[0].url).toContain("listOptions.limit=50");
    expect(requests[0].url).toContain("listOptions.continue=abc");
    expect((await request("/api/platform/workflows/workflows?limit=99999")).status).toBe(400);
  });
  it("loads every template page instead of silently truncating the library", async () => {
    upstreamReply = url => url.includes("listOptions.continue=page2") ? { items: [{ metadata: { name: "second" } }], metadata: {} } : { items: [{ metadata: { name: "first" } }], metadata: { continue: "page2" } };
    const response = await request("/api/platform/workflow-templates/workflows");
    expect(response.status).toBe(200);
    expect((await response.json()).map((item: any) => item.metadata.name)).toEqual(["first", "second"]);
    expect(requests).toHaveLength(2);
  });
  it("bounds concurrent buffered upstream requests when Argo is slow", async () => {
    let release!: () => void;
    upstreamPause = new Promise(resolve => { release = resolve; });
    const pending = Array.from({ length: 20 }, () => request("/api/platform/workflows/workflows"));
    try { await expect.poll(() => requests.length).toBe(16); }
    finally { release(); }
    const responses = await Promise.all(pending);
    expect(responses.filter(response => response.status === 503)).toHaveLength(4);
    for (const response of responses) await response.text();
  });
  it("requires and preserves a template revision so updates remain conditional", async () => {
    const template = { ...workflow, kind: "WorkflowTemplate", metadata: { name: "example", namespace: "workflows" } };
    const url = "/api/platform/workflow-templates/workflows/example";
    expect((await request(url, { method: "PUT", body: JSON.stringify(template) })).status).toBe(409);
    expect(requests).toHaveLength(0);
    const response = await request(url, { method: "PUT", body: JSON.stringify({ ...template, metadata: { ...template.metadata, resourceVersion: "123" } }) });
    expect(response.status).toBe(200);
    expect(requests[0].body.template.metadata.resourceVersion).toBe("123");
    upstreamStatus = 409;
    expect((await request(url, { method: "PUT", body: JSON.stringify({ ...template, metadata: { ...template.metadata, resourceVersion: "123" } }) })).status).toBe(409);
  });
  it("removes old run metadata before submitting a copied workflow", async () => {
    const response = await request("/api/platform/workflows/workflows", { method: "POST", body: JSON.stringify({ workflow: {
      ...workflow, metadata: { ...workflow.metadata, uid: "old-uid", resourceVersion: "old-version", creationTimestamp: "old-time", managedFields: [], labels: { "workflows.argoproj.io/completed": "true", "workflows.argoproj.io/phase": "Succeeded", app: "example" } }, status: { phase: "Succeeded" }, spec: { ...workflow.spec, shutdown: "Terminate", activeDeadlineSeconds: 0 },
    } }) });
    expect(response.status).toBe(200);
    expect(requests[0].body.workflow.metadata).not.toHaveProperty("resourceVersion");
    expect(requests[0].body.workflow.metadata).not.toHaveProperty("uid");
    expect(requests[0].body.workflow).not.toHaveProperty("status");
    expect(requests[0].body.workflow.metadata.labels).toEqual({ app: "example" });
    expect(requests[0].body.workflow.spec).not.toHaveProperty("shutdown");
    expect(requests[0].body.workflow.spec).not.toHaveProperty("activeDeadlineSeconds");
  });
  it("normalizes Argo REST resources that omit Kubernetes type metadata", async () => {
    upstreamBody = { metadata: { name: "example", namespace: "workflows", resourceVersion: "123" }, spec: { entrypoint: "main", templates: [] } };
    const response = await request("/api/platform/workflow-templates/workflows/example");
    const template = await response.json();
    expect(template).toMatchObject({ kind: "WorkflowTemplate", apiVersion: "argoproj.io/v1alpha1" });
    expect((await request("/api/platform/workflow-templates/workflows/example", { method: "PUT", body: JSON.stringify(upstreamBody) })).status).toBe(200);
    upstreamBody = null;
    expect((await request("/api/platform/workflow-templates/workflows/example")).status).toBe(502);
  });
  it.each([
    ["gemini-2.5-flash", "models/gemini-2.5-flash"],
    ["models/gemini-2.5-flash", "models/gemini-2.5-flash"],
    ["tunedModels/example-model", "tunedModels/example-model"],
  ])("routes AI model %s through the native Gemini REST endpoint", async (geminiModel, modelResource) => {
    await app.close();
    app = await createProductionServer({ ...config, geminiApiKey: "test-gemini-key", geminiModel });
    base = await listen(app.server);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith("https://generativelanguage.googleapis.com/")) {
        expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/${modelResource}:generateContent`);
        expect(init?.headers).toMatchObject({ "x-goog-api-key": "test-gemini-key" });
        expect(JSON.parse(String(init?.body))).toMatchObject({
          contents: [{ role: "user", parts: [{ text: "Return only raw Argo Workflow YAML for: Echo pipeline" }] }],
          generationConfig: { maxOutputTokens: 8192 },
        });
        return Response.json({ candidates: [{ content: { parts: [{ text: "apiVersion: argoproj.io/v1alpha1" }] } }] });
      }
      return originalFetch(input, init);
    };
    try {
      const response = await request("/api/platform/ai/workflow/generate", { method: "POST", body: JSON.stringify({ description: "Echo pipeline" }) });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ content: "apiVersion: argoproj.io/v1alpha1" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("production configuration", () => {
  const env = { PUBLIC_URL: "https://builder.example", ARGO_ENDPOINT: "https://argo.example", ARGO_NAMESPACE: "workflows", ARGO_TOKEN: "token", AUTH_PROXY_SECRET: secret, DATA_DIR: "/tmp/drafts" };
  it("fails closed on missing or malformed secrets, URL, and namespace", () => {
    for (const overrides of [{ AUTH_PROXY_SECRET: "short" }, { ARGO_TOKEN: "" }, { PUBLIC_URL: "http://builder.example" }, { ARGO_NAMESPACE: "../default" }, { PORT: "NaN" }]) {
      expect(() => loadServerConfig({ ...env, ...overrides })).toThrow();
    }
    expect(loadServerConfig(env).editorGroups).toEqual([]);
    expect(loadServerConfig(env).staticDir).toMatch(/apps\/workflow-builder\/dist$/);
  });
});
