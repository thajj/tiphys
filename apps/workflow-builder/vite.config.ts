import path from "path";
import type { IncomingMessage, ServerResponse } from "node:http";
import react from "@vitejs/plugin-react";
import autoprefixer from "autoprefixer";
import tailwindcss from "tailwindcss";
import type { Connect } from "vite";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { defaultFeatureFlags, defaultPermissions } from "../../packages/platform-sdk/src";
import type {
  Workflow,
  WorkflowTemplateSummary,
} from "../../packages/workflow-domain/src";
import { createWorkflowFromTemplate } from "../../packages/workflow-domain/src";
import {
  geminiModelPath,
  normalizeAuthHeaderValue,
  type DevProxyEnv,
  resolveDevProxyEnv,
} from "./devProxyEnv";

type DraftRecord = Record<string, unknown>;

const draftStore = new Map<string, DraftRecord>();
const workflowTemplateStore = new Map<string, WorkflowTemplateSummary>();
const workflowFallbackStore = new Map<string, Workflow>();
const workflowFallbackLogs = new Map<string, string>();

const resourceKey = (namespace: string, name: string) => `${namespace}:${name}`;

const listNamespaceResources = <T extends { metadata: { namespace: string } }>(
  store: Map<string, T>,
  namespace: string,
) =>
  Array.from(store.values()).filter(
    (resource) => resource.metadata.namespace === namespace,
  );

const readBody = async (req: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
};

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
};

const readArgoResponse = async (
  env: DevProxyEnv,
  targetPath: string,
  method: string,
  body?: unknown,
) => {
  const headers = new Headers();
  const authHeader = normalizeAuthHeaderValue(env.argoToken);
  if (authHeader) {
    headers.set("Authorization", authHeader);
  }
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(`${env.argoEndpoint}${targetPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
};

const proxyArgo = async (
  env: DevProxyEnv,
  req: IncomingMessage,
  res: ServerResponse,
  targetPath: string,
  body?: unknown,
) => {
  const response = await readArgoResponse(env, targetPath, req.method || "GET", body);
  const text = await response.text();
  res.statusCode = response.status;
  res.setHeader(
    "Content-Type",
    response.headers.get("content-type") || "application/json",
  );
  res.end(text);
};

const buildArgoWorkflowListQuery = (url: URL) => {
  const params = new URLSearchParams();
  const limit = url.searchParams.get("limit");
  const cursor = url.searchParams.get("cursor");
  const nameEquals = url.searchParams.get("nameEquals");
  const fields = url.searchParams.get("fields");
  const phases = (url.searchParams.get("phases") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (limit) {
    params.set("listOptions.limit", limit);
  }

  if (cursor) {
    params.set("listOptions.continue", cursor);
  }

  if (phases.length === 1) {
    params.set("listOptions.labelSelector", `workflows.argoproj.io/phase=${phases[0]}`);
  } else if (phases.length > 1) {
    params.set(
      "listOptions.labelSelector",
      `workflows.argoproj.io/phase in (${phases.join(",")})`,
    );
  }

  if (nameEquals) {
    params.set("listOptions.fieldSelector", `metadata.name=${nameEquals}`);
  }

  if (fields) {
    params.set("fields", fields);
  }

  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
};

const createFallbackWorkflow = (namespace: string, workflow: Record<string, unknown>) => {
  const metadata = (workflow.metadata || {}) as Record<string, unknown>;
  const generateName =
    typeof metadata.generateName === "string" ? metadata.generateName : "workflow-";
  const name =
    typeof metadata.name === "string" && metadata.name.trim()
      ? metadata.name
      : `${generateName}${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  const createdWorkflow = {
    ...(workflow as unknown as Workflow),
    metadata: {
      ...(metadata as unknown as Workflow["metadata"]),
      name,
      namespace,
      creationTimestamp: now,
    },
    status: {
      phase: "Running",
      startedAt: now,
      progress: "0/1",
    },
  } satisfies Workflow;

  workflowFallbackStore.set(resourceKey(namespace, name), createdWorkflow);
  workflowFallbackLogs.set(
    resourceKey(namespace, name),
    [
      `[${now}] Workflow submitted through Tiphys dev gateway.`,
      `Workflow: ${name}`,
      `Namespace: ${namespace}`,
    ].join("\n"),
  );
  return createdWorkflow;
};

const getWorkflowLogChunk = (logs: string, cursor?: string) => {
  const lines = logs.split(/\r?\n/).filter(Boolean);
  const startIndex = cursor ? Math.max(0, Number.parseInt(cursor, 10)) : 0;
  const events = lines.slice(startIndex).map((message, index) => ({
    cursor: String(startIndex + index + 1),
    message,
    timestamp: new Date().toISOString(),
  }));
  return {
    events,
    cursor: String(lines.length),
    complete: false,
  };
};

const normalizeWorkflowTemplate = (
  namespace: string,
  input: WorkflowTemplateSummary,
): WorkflowTemplateSummary => ({
  ...input,
  apiVersion: input.apiVersion || "argoproj.io/v1alpha1",
  kind: "WorkflowTemplate",
  metadata: {
    ...input.metadata,
    namespace,
  },
});

const createDevPlatformPlugin = (env: DevProxyEnv) => ({
  name: "workflow-builder-dev-platform",
  configureServer(server: { middlewares: Connect.Server }) {
    server.middlewares.use("/api/platform", async (req, res, next) => {
      const url = new URL(req.url || "/", "http://localhost");
      const pathname = url.pathname;

      try {
        if (pathname === "/config" && req.method === "GET") {
          const aiEnabled = !!env.geminiApiKey && !!env.geminiModel;
          sendJson(res, 200, {
            namespaceScope: env.argoNamespace,
            featureFlags: { ...defaultFeatureFlags, aiAssistant: aiEnabled },
            permissions: { ...defaultPermissions, canUseAI: aiEnabled },
          });
          return;
        }
        if (pathname.startsWith("/session/drafts/")) {
          const [, , , workspaceId, projectId] = pathname.split("/");
          const draftKey = `${workspaceId}:${projectId}`;

          if (req.method === "GET") {
            const record = draftStore.get(draftKey);
            if (!record) {
              sendJson(res, 404, { message: "Draft not found" });
              return;
            }
            sendJson(res, 200, record);
            return;
          }

          if (req.method === "PUT") {
            const body = await readBody(req);
            draftStore.set(draftKey, body as DraftRecord);
            sendJson(res, 200, body);
            return;
          }
        }

        const generateGeminiText = async (
          contents: string,
          jsonMode = false,
        ) => {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/${geminiModelPath(env.geminiModel!)}:generateContent`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": env.geminiApiKey!,
              },
              body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: contents }] }],
                ...(jsonMode
                  ? { generationConfig: { responseMimeType: "application/json" } }
                  : {}),
              }),
            },
          );
          if (!response.ok) {
            throw new Error(`Gemini request failed (${response.status})`);
          }
          const payload = (await response.json()) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          return (payload.candidates?.[0]?.content?.parts || [])
            .map((part) => part.text || "")
            .join("");
        };

        if (pathname === "/ai/workflow/generate" && req.method === "POST") {
          if (!env.geminiApiKey) {
            sendJson(res, 503, { message: "GEMINI_API_KEY is not configured" });
            return;
          }

          const body = (await readBody(req)) as { description: string };
          const text = await generateGeminiText(
            `You are an expert Argo Workflows Architect. Return only raw YAML for this request: "${body.description}".`,
          );
          sendJson(res, 200, { content: text });
          return;
        }

        if (pathname === "/ai/workflow/edit-node" && req.method === "POST") {
          if (!env.geminiApiKey) {
            sendJson(res, 503, { message: "GEMINI_API_KEY is not configured" });
            return;
          }

          const body = (await readBody(req)) as {
            currentData: unknown;
            instruction: string;
          };
          const text = await generateGeminiText(
            `Update the following Argo node JSON using the instruction and return only JSON.\nCurrent node: ${JSON.stringify(body.currentData)}\nInstruction: ${body.instruction}`,
            true,
          );
          sendJson(res, 200, { content: JSON.parse(text || "{}") });
          return;
        }

        if (pathname === "/ai/workflow/analyze" && req.method === "POST") {
          if (!env.geminiApiKey) {
            sendJson(res, 503, { message: "GEMINI_API_KEY is not configured" });
            return;
          }

          const body = await readBody(req);
          const text = await generateGeminiText(
            `Review this workflow builder graph for validation, data flow, and Argo best practices.\n${JSON.stringify(body)}`,
          );
          sendJson(res, 200, { content: text });
          return;
        }

        if (pathname.startsWith("/workflow-templates/")) {
          const segments = pathname.split("/").filter(Boolean);
          const namespace = segments[1] || env.argoNamespace;
          const name = segments[2];
          const action = segments[3];

          if (req.method === "GET" && !name) {
            sendJson(res, 200, listNamespaceResources(workflowTemplateStore, namespace));
            return;
          }

          if (req.method === "POST" && !name) {
            const body = normalizeWorkflowTemplate(
              namespace,
              (await readBody(req)) as WorkflowTemplateSummary,
            );
            workflowTemplateStore.set(resourceKey(namespace, body.metadata.name), body);
            sendJson(res, 200, body);
            return;
          }

          if (req.method === "GET" && name && !action) {
            const resource = workflowTemplateStore.get(resourceKey(namespace, name));
            if (!resource) {
              sendJson(res, 404, { message: `Workflow template ${name} not found` });
              return;
            }
            sendJson(res, 200, resource);
            return;
          }

          if (req.method === "PUT" && name && !action) {
            const body = normalizeWorkflowTemplate(
              namespace,
              (await readBody(req)) as WorkflowTemplateSummary,
            );
            workflowTemplateStore.set(resourceKey(namespace, name), body);
            sendJson(res, 200, body);
            return;
          }

          if (req.method === "DELETE" && name && !action) {
            workflowTemplateStore.delete(resourceKey(namespace, name));
            sendJson(res, 200, { deleted: true });
            return;
          }

          if (req.method === "POST" && name && action === "run") {
            const template = workflowTemplateStore.get(resourceKey(namespace, name));
            if (!template) {
              sendJson(res, 404, { message: `Workflow template ${name} not found` });
              return;
            }

            const workflow = createWorkflowFromTemplate(template, namespace);
            try {
              const response = await readArgoResponse(
                env,
                `/api/v1/workflows/${namespace}`,
                "POST",
                workflow,
              );
              const payload = await response.text();
              res.statusCode = response.status;
              res.setHeader(
                "Content-Type",
                response.headers.get("content-type") || "application/json",
              );
              res.end(payload);
            } catch {
              sendJson(res, 200, createFallbackWorkflow(namespace, workflow));
            }
            return;
          }
        }

        if (pathname.startsWith("/workflows/")) {
          const segments = pathname.split("/").filter(Boolean);
          const namespace = segments[1] || env.argoNamespace;
          const name = segments[2];
          const action = segments[3];
          const fallbackWorkflowKey = name ? resourceKey(namespace, name) : "";

          if (req.method === "GET" && segments[2] === "templates") {
            sendJson(res, 200, listNamespaceResources(workflowTemplateStore, namespace));
            return;
          }

          if (req.method === "GET" && action === "logs" && segments[4] === "stream" && name) {
            const cursor = url.searchParams.get("cursor") || undefined;
            const fallbackLogs = workflowFallbackLogs.get(fallbackWorkflowKey);
            if (fallbackLogs) {
              sendJson(res, 200, getWorkflowLogChunk(fallbackLogs, cursor));
              return;
            }

            const podName = url.searchParams.get("podName");
            const query = podName
              ? `?podName=${encodeURIComponent(podName)}&logOptions.container=main`
              : "?logOptions.container=main";
            const response = await readArgoResponse(
              env,
              `/api/v1/workflows/${namespace}/${name}/log${query}`,
              "GET",
            );
            const logs = await response.text();
            if (!response.ok) {
              sendJson(res, response.status, { message: logs || "Failed to read workflow logs" });
              return;
            }
            sendJson(res, 200, getWorkflowLogChunk(logs, cursor));
            return;
          }

          if (req.method === "GET" && action === "logs" && name) {
            const fallbackLogs = workflowFallbackLogs.get(fallbackWorkflowKey);
            if (fallbackLogs) {
              res.statusCode = 200;
              res.setHeader("Content-Type", "text/plain");
              res.end(fallbackLogs);
              return;
            }

            const podName = url.searchParams.get("podName");
            const query = podName
              ? `?podName=${encodeURIComponent(podName)}&logOptions.container=main`
              : "?logOptions.container=main";
            await proxyArgo(env, req, res, `/api/v1/workflows/${namespace}/${name}/log${query}`);
            return;
          }

          if (req.method === "GET" && !name) {
            try {
              await proxyArgo(
                env,
                req,
                res,
                `/api/v1/workflows/${namespace}${buildArgoWorkflowListQuery(url)}`,
              );
            } catch {
              sendJson(res, 200, listNamespaceResources(workflowFallbackStore, namespace));
            }
            return;
          }

          if (req.method === "POST" && !name) {
            const body = await readBody(req);
            try {
              await proxyArgo(env, req, res, `/api/v1/workflows/${namespace}`, body);
            } catch {
              sendJson(
                res,
                200,
                createFallbackWorkflow(namespace, body.workflow || body),
              );
            }
            return;
          }

          if (name && req.method === "GET" && !action) {
            const fallbackWorkflow = workflowFallbackStore.get(fallbackWorkflowKey);
            if (fallbackWorkflow) {
              sendJson(res, 200, fallbackWorkflow);
              return;
            }
            await proxyArgo(env, req, res, `/api/v1/workflows/${namespace}/${name}`);
            return;
          }

          if (name && req.method === "DELETE" && !action) {
            workflowFallbackStore.delete(fallbackWorkflowKey);
            workflowFallbackLogs.delete(fallbackWorkflowKey);
            try {
              await proxyArgo(env, req, res, `/api/v1/workflows/${namespace}/${name}`);
            } catch {
              sendJson(res, 200, { deleted: true });
            }
            return;
          }

          if (name && action === "suspend" && req.method === "PUT") {
            const fallbackWorkflow = workflowFallbackStore.get(fallbackWorkflowKey);
            if (fallbackWorkflow) {
              workflowFallbackStore.set(fallbackWorkflowKey, {
                ...fallbackWorkflow,
                status: {
                  ...fallbackWorkflow.status,
                  phase: "Pending",
                },
              });
              sendJson(res, 200, { updated: true });
              return;
            }
            await proxyArgo(env, req, res, `/api/v1/workflows/${namespace}/${name}/suspend`, {});
            return;
          }

          if (name && action === "resume" && req.method === "PUT") {
            const fallbackWorkflow = workflowFallbackStore.get(fallbackWorkflowKey);
            if (fallbackWorkflow) {
              workflowFallbackStore.set(fallbackWorkflowKey, {
                ...fallbackWorkflow,
                status: {
                  ...fallbackWorkflow.status,
                  phase: "Running",
                },
              });
              sendJson(res, 200, { updated: true });
              return;
            }
            await proxyArgo(env, req, res, `/api/v1/workflows/${namespace}/${name}/resume`, {});
            return;
          }
        }

        next();
      } catch (error) {
        sendJson(res, 500, {
          message:
            error instanceof Error
              ? error.message
              : "Internal platform dev server error",
        });
      }
    });
  },
});

export default defineConfig(({ mode }) => {
  const envDir = path.resolve(__dirname, "../..");
  const env = loadEnv(mode, envDir, "");

  return {
    envDir,
    server: {
      port: 3000,
      host: "127.0.0.1",
      strictPort: true,
    },
    css: {
      postcss: {
        plugins: [
          tailwindcss({ config: path.resolve(__dirname, "../../tailwind.config.cjs") }),
          autoprefixer(),
        ],
      },
    },
    plugins: [
      react(),
      tsconfigPaths(),
      createDevPlatformPlugin(resolveDevProxyEnv(env, envDir, mode)),
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("/reactflow/")) return "graph";
          },
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
  };
});
