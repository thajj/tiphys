import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { geminiModelPath, normalizeAuthHeaderValue } from "../devProxyEnv";
import { createDraftStore } from "./draftStore";
import type { ServerConfig } from "./config";

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_UPSTREAM_BYTES = 10 * 1024 * 1024;
const MAX_IN_FLIGHT = 16;
const normalizeResource = (value: unknown, kind: "Workflow" | "WorkflowTemplate") => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(502, "Argo returned an invalid resource");
  const resource = value as Record<string, unknown>;
  return { ...resource, apiVersion: resource.apiVersion || "argoproj.io/v1alpha1", kind: resource.kind || kind };
};
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
const fail = (status: number, message: string): never => { throw new HttpError(status, message); };
const object = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(400, "Expected a JSON object");
  return value as Record<string, any>;
};
const resourceName = (name: string) => {
  if (typeof name !== "string" || name.length > 253 || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(name) || name.includes("..")) fail(400, "Invalid resource name");
  return name;
};
const json = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
};
const readBody = async (req: IncomingMessage) => {
  if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) fail(415, "Content-Type must be application/json");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) fail(413, "Request body is too large");
    chunks.push(buffer);
  }
  try { return object(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
  catch (error) { if (error instanceof HttpError) throw error; return fail(400, "Invalid JSON body"); }
};

export async function createProductionServer(config: ServerConfig) {
  const drafts = createDraftStore(config.dataDir);
  await drafts.initialize();
  // Refuse startup when the browser build is missing.
  await stat(path.join(config.staticDir, "index.html"));
  const rates = new Map<string, { count: number; aiCount: number; reset: number }>();
  let inFlight = 0;
  let draining = false;
  const expectedSecret = createHash("sha256").update(config.proxySecret).digest();
  const upstream = async (targetPath: string, method = "GET", body?: unknown, timeoutMs = config.upstreamTimeoutMs) => {
    try {
      const response = await fetch(`${config.argoEndpoint}${targetPath}`, {
        method,
        headers: {
          Authorization: normalizeAuthHeaderValue(config.argoToken),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      if (reader) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.length;
            if (length > MAX_UPSTREAM_BYTES) fail(502, "Argo response exceeded the size limit");
            chunks.push(value);
          }
        } finally { await reader.cancel().catch(() => {}); }
      }
      const text = Buffer.concat(chunks).toString("utf8");
      if (!response.ok) {
        // Do not return raw upstream bodies, URLs, or credentials to users.
        fail(response.status >= 400 && response.status < 500 ? response.status : 502, `Argo request failed (${response.status})`);
      }
      return text;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      fail((error as Error).name === "TimeoutError" ? 504 : 502, "Argo is unavailable; the operation was not confirmed");
    }
  };
  const upstreamJson = async (targetPath: string, method = "GET", body?: unknown, timeoutMs = config.upstreamTimeoutMs) => {
    const text = await upstream(targetPath, method, body, timeoutMs);
    try { return text ? JSON.parse(text) : {}; }
    catch { return fail(502, "Argo returned invalid JSON"); }
  };
  const server = createServer(async (req, res) => {
    const startedAt = Date.now();
    const requestId = randomUUID();
    res.setHeader("X-Request-Id", requestId);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Strict-Transport-Security", "max-age=31536000");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'");
    let logPath = "/invalid";
    res.on("finish", () => {
      console.info(JSON.stringify({ event: "http.request", requestId, method: req.method, path: logPath, status: res.statusCode, durationMs: Date.now() - startedAt }));
    });
    let counted = false;
    try {
      const url = new URL(req.url || "/", "http://gateway.invalid");
      logPath = url.pathname.startsWith("/api/") ? url.pathname.split("/").slice(0, 4).join("/") : url.pathname;
      if (url.pathname === "/healthz" && req.method === "GET") {
        json(res, draining ? 503 : 200, { status: draining ? "draining" : "ok" }); return;
      }
      if (draining || inFlight >= MAX_IN_FLIGHT) fail(503, "Gateway is busy; retry later");
      inFlight++; counted = true;
      if (url.pathname === "/readyz" && req.method === "GET") {
        try {
          await upstreamJson(`/api/v1/workflows/${config.argoNamespace}?listOptions.limit=1&fields=metadata`, "GET", undefined, Math.min(config.upstreamTimeoutMs, 3000));
          json(res, 200, { status: "ready" });
        } catch { json(res, 503, { status: "upstream unavailable" }); }
        return;
      }
      const providedSecret = req.headers["x-auth-proxy-secret"];
      const subject = req.headers["x-auth-request-user"];
      if (typeof providedSecret !== "string" || !timingSafeEqual(createHash("sha256").update(providedSecret).digest(), expectedSecret) ||
        typeof subject !== "string" || !subject.trim() || subject.length > 256 || /[\r\n\x00]/.test(subject)) {
        return fail(401, "Authentication required");
      }
      const groups = String(req.headers["x-auth-request-groups"] || "").split(",").map(group => group.trim());
      const canWrite = config.editorGroups.some(group => groups.includes(group));
      const now = Date.now();
      for (const [key, rate] of rates) { if (rate.reset <= now) rates.delete(key); }
      if (!rates.has(subject) && rates.size >= 10000) fail(503, "Rate limiter is busy");
      const rate = rates.get(subject) || { count: 0, aiCount: 0, reset: now + 60000 };
      rates.set(subject, rate);
      if (++rate.count > 600) { res.setHeader("Retry-After", "60"); fail(429, "Request rate limit exceeded"); }
      const mutation = !["GET", "HEAD"].includes(req.method || "GET");
      if (mutation) {
        if (!canWrite) fail(403, "Editor permissions required");
        if (req.headers.origin !== config.publicOrigin) fail(403, "Invalid request origin");
        if (req.headers["sec-fetch-site"] === "cross-site") fail(403, "Cross-site requests are forbidden");
      }
      const apiPath = "/api/platform";
      if (url.pathname === `${apiPath}/config` && req.method === "GET") {
        json(res, 200, {
          workspaceId: createHash("sha256").update(subject).digest("hex"), projectId: "workflow-builder",
          namespaceScope: config.argoNamespace,
          featureFlags: {
            aiAssistant: !!config.geminiApiKey, logStreaming: true, templateLibrary: true,
            workflowTemplateManagement: true, browserNotifications: true,
          },
          permissions: {
            canEditWorkflow: canWrite, canSubmitWorkflow: canWrite, canUseAI: canWrite && !!config.geminiApiKey, canViewLogs: true,
            canManageWorkflowTemplates: canWrite, canOpenNativeArgoUi: false,
          },
        }); return;
      }
      if (url.pathname.startsWith(`${apiPath}/`)) {
        const segments = url.pathname.slice(apiPath.length + 1).split("/").map(segment => {
          try { const decoded = decodeURIComponent(segment); if (decoded.includes("/") || decoded.includes("\\")) fail(400, "Invalid path segment"); return decoded; }
          catch { return fail(400, "Invalid path segment"); }
        });
        const [resource, namespace, name, action, subaction] = segments;
        if (resource === "session" && namespace === "drafts" && segments.length === 4 && name && action) {
          if (req.method === "GET") {
            const draft = await drafts.load(subject, name, action);
            json(res, draft ? 200 : 404, draft || { message: "Draft not found" }); return;
          }
          if (req.method === "PUT") {
            const draft = await readBody(req);
            if (!Array.isArray(draft.sessions) || typeof draft.savedAt !== "number" || !(draft.activeSessionId === null || typeof draft.activeSessionId === "string")) fail(400, "Invalid workflow draft");
            json(res, 200, await drafts.save(subject, name, action, draft)); return;
          }
          fail(405, "Method not allowed");
        }
        if (["workflows", "workflow-templates"].includes(resource)) {
          if (namespace !== config.argoNamespace) fail(403, "Namespace is outside the configured scope");
          if (name) resourceName(name);
          const base = `/api/v1/${resource}/${namespace}`;
          if (resource === "workflows" && name && action === "logs" && segments.length <= 5 && (!subaction || subaction === "stream") && req.method === "GET") {
            const params = new URLSearchParams({ "logOptions.container": "main", "logOptions.follow": "false", "logOptions.tailLines": "1000", "logOptions.timestamps": "true" });
            const podName = url.searchParams.get("podName");
            if (podName) params.set("podName", resourceName(podName));
            const raw = await upstream(`${base}/${name}/log?${params}`);
            const lines = raw.split(/\r?\n/).filter(Boolean).map(line => {
              try { const entry = JSON.parse(line).result; return { message: String(entry?.content ?? line), timestamp: entry?.timestamp }; }
              catch { return { message: line, timestamp: undefined }; }
            });
            if (!subaction) { res.setHeader("Content-Type", "text/plain; charset=utf-8"); res.end(lines.map(line => line.message).join("\n")); return; }
            // Use content fingerprints so a rolling tail does not freeze a numeric cursor.
            const cursor = url.searchParams.get("cursor");
            const events = lines.map(line => ({ ...line, cursor: createHash("sha256").update(JSON.stringify(line)).digest("hex") }));
            const index = cursor ? events.findIndex(event => event.cursor === cursor) : -1;
            json(res, 200, { events: events.slice(index + 1), cursor: events.at(-1)?.cursor || cursor, complete: false }); return;
          }
          if (!name && segments.length === 2 && req.method === "GET") {
            const params = new URLSearchParams({ "listOptions.limit": "100" });
            const limit = url.searchParams.get("limit");
            if (limit) { if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 1000) fail(400, "limit must be between 1 and 1000"); params.set("listOptions.limit", limit); }
            if (url.searchParams.has("cursor")) params.set("listOptions.continue", url.searchParams.get("cursor")!);
            const phases = url.searchParams.get("phases")?.split(",").filter(Boolean) || [];
            if (phases.some(phase => !["Pending", "Running", "Succeeded", "Failed", "Error"].includes(phase))) fail(400, "Invalid workflow phase");
            if (phases.length) params.set("listOptions.labelSelector", `workflows.argoproj.io/phase in (${phases.join(",")})`);
            if (url.searchParams.has("nameEquals")) params.set("listOptions.fieldSelector", `metadata.name=${resourceName(url.searchParams.get("nameEquals")!)}`);
            if (url.searchParams.has("fields")) params.set("fields", url.searchParams.get("fields")!);
            let result = await upstreamJson(`${base}?${params}`);
            if (resource === "workflow-templates") {
              const items = (result.items || []).map((item: unknown) => normalizeResource(item, "WorkflowTemplate"));
              const deadline = Date.now() + config.upstreamTimeoutMs;
              for (let page = 1; result.metadata?.continue; page++) {
                if (page >= 100 || Date.now() >= deadline) fail(502, "Template listing exceeded the gateway limit");
                params.set("listOptions.continue", result.metadata.continue);
                result = await upstreamJson(`${base}?${params}`, "GET", undefined, Math.max(100, deadline - Date.now()));
                items.push(...(result.items || []).map((item: unknown) => normalizeResource(item, "WorkflowTemplate")));
                if (Buffer.byteLength(JSON.stringify(items)) > MAX_UPSTREAM_BYTES) fail(502, "Template listing exceeded the gateway limit");
              }
              json(res, 200, items);
            } else json(res, 200, { ...result, items: (result.items || []).map((item: unknown) => normalizeResource(item, "Workflow")) });
            return;
          }
          if (name && !action && segments.length === 3 && ["GET", "DELETE"].includes(req.method!)) {
            const result = await upstreamJson(`${base}/${name}`, req.method);
            json(res, 200, req.method === "GET" ? normalizeResource(result, resource === "workflows" ? "Workflow" : "WorkflowTemplate") : result); return;
          }
          if (resource === "workflows" && name && ["suspend", "resume"].includes(action) && segments.length === 4 && req.method === "PUT") {
            await readBody(req);
            json(res, 200, normalizeResource(await upstreamJson(`${base}/${name}/${action}`, "PUT", {}), "Workflow")); return;
          }
          if (resource === "workflow-templates" && name && action === "run" && segments.length === 4 && req.method === "POST") {
            await readBody(req);
            json(res, 200, normalizeResource(await upstreamJson(`/api/v1/workflows/${namespace}`, "POST", { namespace, workflow: {
              apiVersion: "argoproj.io/v1alpha1", kind: "Workflow", metadata: { namespace, generateName: `${name}-` }, spec: { workflowTemplateRef: { name } },
            } }), "Workflow")); return;
          }
          if ((!name && segments.length === 2 && req.method === "POST") || (resource === "workflow-templates" && name && !action && segments.length === 3 && req.method === "PUT")) {
            const body = await readBody(req);
            const document = object(resource === "workflows" ? body.workflow : body);
            const metadata = object(document.metadata);
            object(document.spec);
            const kind = resource === "workflows" ? "Workflow" : "WorkflowTemplate";
            if (document.apiVersion && document.apiVersion !== "argoproj.io/v1alpha1" || document.kind && document.kind !== kind) fail(400, "Invalid Argo resource kind or apiVersion");
            document.apiVersion = "argoproj.io/v1alpha1";
            document.kind = kind;
            if (metadata.namespace && metadata.namespace !== namespace || body.namespace && body.namespace !== namespace) fail(403, "Resource namespace does not match the configured scope");
            if (metadata.name) resourceName(metadata.name);
            else if (resource === "workflows" && typeof metadata.generateName === "string") resourceName(metadata.generateName.replace(/-$/, ""));
            else fail(400, "Resource name or generateName is required");
            if (name && metadata.name !== name) fail(400, "Resource name does not match the URL");
            metadata.namespace = namespace;
            if (req.method === "PUT" && (typeof metadata.resourceVersion !== "string" || !metadata.resourceVersion.trim())) {
              fail(409, "Template revision is required; reload the template before updating");
            }
            if (req.method === "POST") {
              const clonedWorkflow = resource === "workflows" && (metadata.uid || metadata.resourceVersion || document.status);
              // A resubmitted run or copied template is a new Kubernetes resource.
              for (const field of ["resourceVersion", "uid", "creationTimestamp", "deletionTimestamp", "deletionGracePeriodSeconds", "managedFields", "generation"]) delete metadata[field];
              delete document.status;
              if (resource === "workflows") {
                for (const label of ["creator", "creator-email", "creator-preferred-username", "phase", "completed", "workflow-archiving-status"]) {
                  if (metadata.labels) delete metadata.labels[`workflows.argoproj.io/${label}`];
                }
                if (clonedWorkflow) {
                  delete document.spec.shutdown;
                  if (document.spec.activeDeadlineSeconds === 0) delete document.spec.activeDeadlineSeconds;
                }
              }
            }
            json(res, 200, normalizeResource(await upstreamJson(`${base}${name ? `/${name}` : ""}`, req.method, { namespace, [resource === "workflows" ? "workflow" : "template"]: document }), kind)); return;
          }
          fail(405, "Unsupported resource operation");
        }
        if (resource === "ai" && namespace === "workflow" && segments.length === 3 && req.method === "POST" && ["generate", "edit-node", "analyze"].includes(name)) {
          if (!config.geminiApiKey) fail(503, "AI is not configured");
          if (++rate.aiCount > 10) { res.setHeader("Retry-After", "60"); fail(429, "AI rate limit exceeded"); }
          const body = await readBody(req);
          if (JSON.stringify(body).length > 100000) fail(413, "AI input is too large");
          if (name === "generate" && (typeof body.description !== "string" || !body.description.trim()) ||
            name === "edit-node" && (typeof body.instruction !== "string" || !body.instruction.trim() || !body.currentData) ||
            name === "analyze" && (!Array.isArray(body.nodes) || !Array.isArray(body.edges))) fail(400, "Invalid AI request");
          const contents = name === "generate" ? `Return only raw Argo Workflow YAML for: ${body.description}` :
            name === "edit-node" ? `Return only updated Argo node JSON. Current: ${JSON.stringify(body.currentData)} Instruction: ${body.instruction}` :
              `Review this workflow graph for validation, data flow, and Argo best practices: ${JSON.stringify(body)}`;
          const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/${geminiModelPath(config.geminiModel!)}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": config.geminiApiKey },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: contents }] }],
              generationConfig: { maxOutputTokens: 8192, ...(name === "edit-node" ? { responseMimeType: "application/json" } : {}) },
            }),
            signal: AbortSignal.timeout(config.upstreamTimeoutMs),
          });
          if (!aiResponse.ok) fail(502, `AI request failed (${aiResponse.status})`);
          const payload = (await aiResponse.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
          const text = (payload.candidates?.[0]?.content?.parts || []).map(part => part.text || "").join("");
          json(res, 200, { content: name === "edit-node" ? JSON.parse(text || "{}") : text }); return;
        }
        fail(404, "API route not found");
      }
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) fail(404, "API route not found");
      if (!["GET", "HEAD"].includes(req.method || "")) fail(405, "Method not allowed");
      let pathname: string;
      try { pathname = decodeURIComponent(url.pathname); } catch { return fail(400, "Invalid URL"); }
      if (pathname.includes("\\") || pathname.includes("\0") || pathname.split("/").some(segment => segment.startsWith("."))) fail(404, "Not found");
      let filename = path.resolve(config.staticDir, `.${pathname}`);
      if (!filename.startsWith(`${config.staticDir}${path.sep}`) && filename !== config.staticDir) fail(404, "Not found");
      let fileStat;
      try { fileStat = await stat(filename); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (!fileStat?.isFile()) {
        if (path.extname(pathname) || pathname.startsWith("/assets/")) fail(404, "Not found");
        filename = path.join(config.staticDir, "index.html");
      }
const mimeTypes: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2" };
      res.setHeader("Content-Type", mimeTypes[path.extname(filename)] || "application/octet-stream");
      if (pathname.startsWith("/assets/")) res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      res.end(req.method === "HEAD" ? undefined : await readFile(filename));
    } catch (error) {
      if (res.destroyed || res.writableEnded) return;
      const status = error instanceof HttpError ? error.status : 500;
      // Unexpected failures may contain upstream credential-bearing details; expose only validation errors.
      const message = error instanceof HttpError ? error.message : "Platform request failed";
      json(res, status, { message, requestId });
    } finally { if (counted) inFlight--; }
  });
  server.requestTimeout = 60000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 1000;
  return {
    server,
    async close() {
      draining = true;
      await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); });
    },
  };
}
