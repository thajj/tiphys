// A deterministic Argo REST double. It validates the gateway's real request
// envelopes but does not execute containers or claim live-cluster coverage.
export function createArgoFixture() {
  const workflows = new Map();
  const templates = new Map();
  let sequence = 0;
  const reply = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  return async (req, res) => {
    if (req.headers.authorization !== "Bearer e2e-server-only-argo-token") {
      reply(res, 401, { message: "Missing Argo credential" }); return;
    }
    const url = new URL(req.url, "http://argo.test");
    const match = url.pathname.match(/^\/api\/v1\/(workflows|workflow-templates)\/workflows(?:\/([^/]+))?(?:\/(log|suspend|resume))?$/);
    if (!match) { reply(res, 404, { message: "Unknown fixture route" }); return; }
    const [, resource, name, action] = match;
    const records = resource === "workflows" ? workflows : templates;
    if (req.method === "GET") {
      if (action === "log" && records.has(name)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ result: { content: `Hello from ArgoCanvas: ${name}`, timestamp: records.get(name).status.finishedAt } }) + "\n"); return;
      }
      if (name) { reply(res, records.has(name) ? 200 : 404, records.get(name) || { message: "Resource not found" }); return; }
      let items = [...records.values()];
      const selector = url.searchParams.get("listOptions.fieldSelector");
      if (selector) items = items.filter(item => `metadata.name=${item.metadata.name}` === selector);
      reply(res, 200, { items, metadata: {} }); return;
    }
    if (req.method === "DELETE") {
      const deleted = records.delete(name);
      reply(res, deleted ? 200 : 404, deleted ? {} : { message: "Resource not found" }); return;
    }
    let body;
    try {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      body = JSON.parse(raw || "{}");
    } catch { reply(res, 400, { message: "Invalid JSON" }); return; }
    if (action && req.method === "PUT" && records.has(name)) {
      const record = records.get(name);
      record.spec.suspend = action === "suspend";
      reply(res, 200, record); return;
    }
    const document = body[resource === "workflows" ? "workflow" : "template"];
    if (body.namespace !== "workflows" || document?.metadata?.namespace !== "workflows" || !document?.spec) {
      reply(res, 400, { message: "Invalid Argo resource envelope" }); return;
    }
    if (document.metadata.generateName?.startsWith("reject-submission")) {
      reply(res, 422, { message: "Workflow rejected by the test admission policy" }); return;
    }
    if (req.method === "PUT" && (!templates.has(name) || document.metadata.resourceVersion !== templates.get(name).metadata.resourceVersion)) {
      reply(res, 409, { message: "Resource version conflict" }); return;
    }
    const id = name || document.metadata.name || `${document.metadata.generateName}${++sequence}`;
    if (req.method === "POST" && records.has(id)) { reply(res, 409, { message: "Already exists" }); return; }
    // Keep sample runs recent in captures while preserving a fixed one-second duration.
    const completedAt = Date.now();
    const finishedAt = new Date(completedAt).toISOString();
    const startedAt = new Date(completedAt - 1000).toISOString();
    const record = {
      ...document,
      metadata: { ...document.metadata, name: id, uid: `fixture-${++sequence}`, resourceVersion: String(sequence), creationTimestamp: startedAt },
      ...(resource === "workflows" ? { status: { phase: "Succeeded", startedAt, finishedAt } } : {}),
    };
    // Argo REST omits TypeMeta; exercise the production normalization path.
    delete record.apiVersion; delete record.kind;
    records.set(id, record);
    reply(res, 200, record);
  };
}
