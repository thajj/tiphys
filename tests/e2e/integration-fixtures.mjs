// Local service doubles used only by the browser-test harness. The production
// gateway still derives feature flags, permissions, and request shapes itself.
import { readFileSync } from "node:fs";

export const geminiFixtureKey = "e2e-gemini-fixture-not-a-real-api-key";
export const geminiFixtureModel = "gemini-e2e-fixture";

// Reuse the checked-in, harmless four-step workflow shown in the UI guide.
const generatedWorkflow = readFileSync(new URL("../../examples/hello-workflow.yaml", import.meta.url), "utf8");

function generateFixtureText(prompt) {
  if (prompt.startsWith("Return only raw Argo Workflow YAML for: ")) return generatedWorkflow;
  const editPrefix = "Return only updated Argo node JSON. Current: ";
  if (prompt.startsWith(editPrefix)) {
    const input = prompt.slice(editPrefix.length);
    let node;
    // The model prompt contains JSON followed by an instruction. Find the JSON
    // boundary without assuming that node strings cannot contain that separator.
    let position = input.indexOf(" Instruction: ");
    while (position !== -1) {
      try { node = JSON.parse(input.slice(0, position)); break; }
      catch { position = input.indexOf(" Instruction: ", position + 1); }
    }
    if (!node || typeof node !== "object") throw new Error("Invalid AI edit fixture request");
    node.retryStrategy = { limit: 3, retryPolicy: "OnFailure", backoff: { duration: "5s", factor: 2, maxDuration: "1m" } };
    const execution = node.container || node.script;
    if (execution) execution.resources = { ...execution.resources, requests: { ...execution.resources?.requests, cpu: "100m", memory: "128Mi" }, limits: { ...execution.resources?.limits, cpu: "500m", memory: "256Mi" } };
    node.description = "Retry transient failures with bounded backoff and explicit CPU and memory budgets.";
    return JSON.stringify(node);
  }
  const analysisPrefix = "Review this workflow graph for validation, data flow, and Argo best practices: ";
  if (prompt.startsWith(analysisPrefix)) {
    const { nodes, edges } = JSON.parse(prompt.slice(analysisPrefix.length));
    return `Workflow review\n\nThis graph contains ${nodes.length} steps and ${edges.length} dependencies.\n\n• Execution order: confirm each downstream step receives the artifacts or parameters it needs.\n• Failure handling: use bounded retries for transient failures and fail fast on invalid data.\n• Resource budgets: set CPU and memory requests and limits for every container.\n• Release check: review the generated YAML, runner permissions, and sample output before submitting.`;
  }
  throw new Error("Unrecognized AI fixture operation");
}

export function installGeminiFixture() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return originalFetch(input, init);
    // Fail closed: neither an unexpected SDK endpoint nor inherited developer
    // settings can turn this documentation fixture into a paid network request.
    if (url.origin !== "https://generativelanguage.googleapis.com" || url.pathname !== `/v1beta/models/${geminiFixtureModel}:generateContent` || request.method !== "POST") {
      throw new Error("External network access is disabled in the integration fixture");
    }
    if (request.headers.get("x-goog-api-key") !== geminiFixtureKey) throw new Error("A fixture-only Gemini API key is required");
    const body = await request.json();
    const prompt = (body.contents || []).flatMap(content => content.parts || []).map(part => part.text || "").join("");
    const text = generateFixtureText(prompt);
    return Response.json({
      candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }],
      modelVersion: geminiFixtureModel,
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 200, totalTokenCount: 300 },
    });
  };
  return () => { globalThis.fetch = originalFetch; };
}
