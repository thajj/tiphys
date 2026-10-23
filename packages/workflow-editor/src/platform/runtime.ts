import type { WorkflowBuilderProps } from "@argocanvas/platform-sdk";
import {
  createConsoleTelemetry,
  createInMemoryEventBus,
  defaultFeatureFlags,
  defaultPermissions,
} from "@argocanvas/platform-sdk";
import type {
  AppEdge,
  AppNode,
  FlowNodeData,
  Workflow,
  WorkflowListPage,
  WorkflowListQuery,
  WorkflowLogStreamChunk,
  WorkflowSession,
  WorkflowTemplateSummary,
} from "@argocanvas/workflow-domain";

export interface WorkflowDraft {
  sessions: WorkflowSession[];
  activeSessionId: string | null;
  savedAt: number;
}

export interface WorkflowsApiClient {
  listWorkflowPage(query: WorkflowListQuery): Promise<WorkflowListPage>;
  listWorkflows(namespace?: string): Promise<Workflow[]>;
  listWorkflowTemplates(namespace?: string): Promise<WorkflowTemplateSummary[]>;
  submitWorkflow(namespace: string, workflow: Workflow): Promise<Workflow>;
  getWorkflow(namespace: string, name: string): Promise<Workflow | undefined>;
  suspendWorkflow(namespace: string, name: string): Promise<boolean>;
  resumeWorkflow(namespace: string, name: string): Promise<boolean>;
  deleteWorkflow(namespace: string, name: string): Promise<boolean>;
  getWorkflowLogs(namespace: string, name: string, podName?: string): Promise<string>;
  streamWorkflowLogs(
    namespace: string,
    name: string,
    options?: { podName?: string; cursor?: string },
  ): Promise<WorkflowLogStreamChunk>;
}

export interface WorkflowTemplatesApiClient {
  list(namespace?: string): Promise<WorkflowTemplateSummary[]>;
  get(namespace: string, name: string): Promise<WorkflowTemplateSummary | undefined>;
  create(namespace: string, template: WorkflowTemplateSummary): Promise<WorkflowTemplateSummary>;
  update(namespace: string, name: string, template: WorkflowTemplateSummary): Promise<WorkflowTemplateSummary>;
  delete(namespace: string, name: string): Promise<boolean>;
  run(namespace: string, name: string): Promise<Workflow>;
}

export interface AiApiClient {
  generateWorkflow(description: string): Promise<string>;
  editNode(currentData: FlowNodeData, instruction: string): Promise<FlowNodeData>;
  analyzeWorkflow(nodes: AppNode[], edges: AppEdge[]): Promise<string>;
}

export interface DraftsApiClient {
  loadDraft(workspaceId: string, projectId: string): Promise<WorkflowDraft | null>;
  saveDraft(workspaceId: string, projectId: string, draft: WorkflowDraft): Promise<WorkflowDraft>;
}

export interface WorkflowRuntime {
  shell: WorkflowBuilderProps;
  clients: {
    workflows: WorkflowsApiClient;
    workflowTemplates: WorkflowTemplatesApiClient;
    ai: AiApiClient;
    drafts: DraftsApiClient;
  };
}

const defaultShell: WorkflowBuilderProps = {
  basePath: "/",
  workspaceId: "local-workspace",
  projectId: "workflow-builder",
  namespaceScope: "default",
  featureFlags: defaultFeatureFlags,
  permissions: defaultPermissions,
  eventBus: createInMemoryEventBus(),
  telemetry: createConsoleTelemetry(),
};

const readErrorMessage = async (response: Response) => {
  const text = await response.text();
  if (!text) {
    return `Request failed with ${response.status}`;
  }

  try {
    const parsed = JSON.parse(text) as { message?: string };
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message;
    }
  } catch {
    // Fall through to the raw body.
  }

  return text;
};

const request = async <T>(input: RequestInfo, init?: RequestInit): Promise<T> => {
  const response = await fetch(input, { ...init, signal: init?.signal || AbortSignal.timeout(45000) });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as T;
};

const backupDraftKey = (workspaceId: string, projectId: string) =>
  `workflow-builder:draft:${workspaceId}:${projectId}`;

type WorkflowListResponse =
  | Workflow[]
  | {
      items?: Workflow[];
      metadata?: {
        continue?: string;
        resourceVersion?: string;
      };
    };

type ListEnvelope<T> = T[] | { items?: T[] };

const normalizeWorkflowListPage = (response: WorkflowListResponse): WorkflowListPage =>
  Array.isArray(response)
    ? { items: response }
    : {
        items: response.items ?? [],
        nextCursor: response.metadata?.continue,
        resourceVersion: response.metadata?.resourceVersion,
      };

const normalizeList = <T>(response: ListEnvelope<T>) =>
  Array.isArray(response) ? response : response.items || [];

export const buildWorkflowListSearchParams = (query: Omit<WorkflowListQuery, "namespace">) => {
  const params = new URLSearchParams();

  if (query.limit && Number.isFinite(query.limit) && query.limit > 0) {
    params.set("limit", String(query.limit));
  }

  if (query.cursor) {
    params.set("cursor", query.cursor);
  }

  const phases = Array.from(new Set(query.phases ?? []));
  if (phases.length > 0) {
    params.set("phases", phases.join(","));
  }

  if (query.nameEquals?.trim()) {
    params.set("nameEquals", query.nameEquals.trim());
  }

  if (query.fields?.trim()) {
    params.set("fields", query.fields.trim());
  }

  return params;
};

const buildNamespacePath = (basePath: string, namespace: string, name?: string) =>
  `${basePath}/${namespace}${name ? `/${encodeURIComponent(name)}` : ""}`;

export const createFetchWorkflowsClient = (
  shell: Pick<WorkflowBuilderProps, "namespaceScope">,
): WorkflowsApiClient => ({
  listWorkflowPage: async (query) => {
    const namespace = query.namespace || shell.namespaceScope;
    const params = buildWorkflowListSearchParams(query);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    const response = await request<WorkflowListResponse>(
      `/api/platform/workflows/${namespace}${suffix}`,
    );
    return normalizeWorkflowListPage(response);
  },
  listWorkflows: async (namespace = shell.namespaceScope) => {
    const response = await request<WorkflowListResponse>(
      `/api/platform/workflows/${namespace}`,
    );
    return normalizeWorkflowListPage(response).items;
  },
  listWorkflowTemplates: async (namespace = shell.namespaceScope) =>
    request<WorkflowTemplateSummary[]>(
      `/api/platform/workflow-templates/${namespace}`,
    ),
  submitWorkflow: async (namespace, workflow) =>
    request<Workflow>(`/api/platform/workflows/${namespace}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ namespace, workflow }),
    }),
  getWorkflow: async (namespace, name) =>
    request<Workflow>(`/api/platform/workflows/${namespace}/${name}`),
  suspendWorkflow: async (namespace, name) => {
    await request(`/api/platform/workflows/${namespace}/${name}/suspend`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    return true;
  },
  resumeWorkflow: async (namespace, name) => {
    await request(`/api/platform/workflows/${namespace}/${name}/resume`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    return true;
  },
  deleteWorkflow: async (namespace, name) => {
    await request(`/api/platform/workflows/${namespace}/${name}`, {
      method: "DELETE",
    });
    return true;
  },
  getWorkflowLogs: async (namespace, name, podName) => {
    const params = new URLSearchParams();
    if (podName) {
      params.set("podName", podName);
    }
    const response = await fetch(
      `/api/platform/workflows/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/logs?${params.toString()}`,
      { signal: AbortSignal.timeout(45000) },
    );
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response.text();
  },
  streamWorkflowLogs: async (namespace, name, options) => {
    const params = new URLSearchParams();
    if (options?.podName) {
      params.set("podName", options.podName);
    }
    if (options?.cursor) {
      params.set("cursor", options.cursor);
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<WorkflowLogStreamChunk>(
      `/api/platform/workflows/${namespace}/${name}/logs/stream${suffix}`,
    );
  },
});

export const createFetchWorkflowTemplatesClient = (
  shell: Pick<WorkflowBuilderProps, "namespaceScope">,
): WorkflowTemplatesApiClient => ({
  list: async (namespace = shell.namespaceScope) =>
    normalizeList(
      await request<ListEnvelope<WorkflowTemplateSummary>>(
        `/api/platform/workflow-templates/${namespace}`,
      ),
    ),
  get: async (namespace, name) =>
    request<WorkflowTemplateSummary>(
      `/api/platform/workflow-templates/${namespace}/${name}`,
    ),
  create: async (namespace, template) =>
    request<WorkflowTemplateSummary>(`/api/platform/workflow-templates/${namespace}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(template),
    }),
  update: async (namespace, name, template) =>
    request<WorkflowTemplateSummary>(
      `/api/platform/workflow-templates/${namespace}/${name}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(template),
      },
    ),
  delete: async (namespace, name) => {
    await request(buildNamespacePath("/api/platform/workflow-templates", namespace, name), {
      method: "DELETE",
    });
    return true;
  },
  run: async (namespace, name) =>
    request<Workflow>(`/api/platform/workflow-templates/${namespace}/${name}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
});

export const createFetchAiClient = (_shell: WorkflowBuilderProps): AiApiClient => ({
  generateWorkflow: async (description) => {
    const response = await request<{ content: string }>(
      "/api/platform/ai/workflow/generate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      },
    );
    return response.content;
  },
  editNode: async (currentData, instruction) => {
    const response = await request<{ content: FlowNodeData }>(
      "/api/platform/ai/workflow/edit-node",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentData, instruction }),
      },
    );
    return response.content;
  },
  analyzeWorkflow: async (nodes, edges) => {
    const response = await request<{ content: string }>(
      "/api/platform/ai/workflow/analyze",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodes, edges }),
      },
    );
    return response.content;
  },
});

export const createFetchDraftsClient = (
  shell: Pick<WorkflowBuilderProps, "telemetry">,
): DraftsApiClient => ({
  async loadDraft(workspaceId, projectId) {
    try {
      return await request<WorkflowDraft>(
        `/api/platform/session/drafts/${workspaceId}/${projectId}`,
      );
    } catch (error) {
      shell.telemetry.track("drafts.remote.load_failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
      try {
        const backup = localStorage.getItem(backupDraftKey(workspaceId, projectId));
        return backup ? (JSON.parse(backup) as WorkflowDraft) : null;
      } catch { return null; }
    }
  },
  async saveDraft(workspaceId, projectId, draft) {
    try { localStorage.setItem(backupDraftKey(workspaceId, projectId), JSON.stringify(draft)); }
    catch { shell.telemetry.track("drafts.local.save_failed"); }
    try {
      return await request<WorkflowDraft>(
        `/api/platform/session/drafts/${workspaceId}/${projectId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        },
      );
    } catch (error) {
      shell.telemetry.track("drafts.remote.save_failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
      throw error;
    }
  },
});

let runtime: WorkflowRuntime = {
  shell: defaultShell,
  clients: {
    workflows: createFetchWorkflowsClient(defaultShell),
    workflowTemplates: createFetchWorkflowTemplatesClient(defaultShell),
    ai: createFetchAiClient(defaultShell),
    drafts: createFetchDraftsClient(defaultShell),
  },
};

export function initializeWorkflowRuntime(nextRuntime: WorkflowRuntime) {
  runtime = nextRuntime;
}

export function getWorkflowRuntime() {
  return runtime;
}
