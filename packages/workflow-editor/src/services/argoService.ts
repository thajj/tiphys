import type {
  WorkflowListPage,
  WorkflowListQuery,
  WorkflowLogStreamChunk,
  WorkflowTemplateSummary,
} from "@tiphys/workflow-domain";
import { getWorkflowRuntime } from "../platform/runtime";

export const argoService = {
  listWorkflowPage: async (query: WorkflowListQuery): Promise<WorkflowListPage> => {
    try {
      const runtime = getWorkflowRuntime();
      return await runtime.clients.workflows.listWorkflowPage({
        ...query,
        namespace: query.namespace || runtime.shell.namespaceScope,
      });
    } catch (e) {
      console.error("Failed to list workflow page", e);
      throw e;
    }
  },

  listWorkflows: async (namespace?: string) => {
    try {
        const runtime = getWorkflowRuntime();
        return await runtime.clients.workflows.listWorkflows(namespace || runtime.shell.namespaceScope);
    } catch (e) {
        console.error("Failed to list workflows", e);
        return [];
    }
  },

  listWorkflowTemplates: async (
    namespace?: string,
  ): Promise<WorkflowTemplateSummary[]> => {
    const runtime = getWorkflowRuntime();
    return await runtime.clients.workflows.listWorkflowTemplates(
      namespace || runtime.shell.namespaceScope,
    );
  },

  submitWorkflow: async (namespace: string, workflow: any) => {
    try {
        return await getWorkflowRuntime().clients.workflows.submitWorkflow(namespace, workflow);
    } catch (e) {
        console.error("Failed to submit workflow", e);
        throw e;
    }
  },

  getWorkflow: async (namespace: string, name: string) => {
    try {
        return await getWorkflowRuntime().clients.workflows.getWorkflow(namespace, name);
    } catch (e) {
        console.error("Failed to get workflow", e);
        return undefined;
    }
  },

  suspendWorkflow: async (namespace: string, name: string): Promise<boolean> => {
    try {
        return await getWorkflowRuntime().clients.workflows.suspendWorkflow(namespace, name);
    } catch (e) {
        console.error("Failed to suspend workflow", e);
        return false;
    }
  },

  resumeWorkflow: async (namespace: string, name: string): Promise<boolean> => {
    try {
        return await getWorkflowRuntime().clients.workflows.resumeWorkflow(namespace, name);
    } catch (e) {
        console.error("Failed to resume workflow", e);
        return false;
    }
  },

  deleteWorkflow: async (namespace: string, name: string): Promise<boolean> => {
    try {
        return await getWorkflowRuntime().clients.workflows.deleteWorkflow(namespace, name);
    } catch (e) {
        console.error("Failed to delete workflow", e);
        return false;
    }
  },

  getWorkflowLogs: async (namespace: string, name: string, podName?: string): Promise<string> => {
     try {
         return await getWorkflowRuntime().clients.workflows.getWorkflowLogs(namespace, name, podName);
     } catch (e) {
         console.error("Failed to get workflow logs", e);
         return "Failed to fetch logs.";
     }
  },

  streamWorkflowLogs: async (
    namespace: string,
    name: string,
    options?: { podName?: string; cursor?: string },
  ): Promise<WorkflowLogStreamChunk> => {
    return getWorkflowRuntime().clients.workflows.streamWorkflowLogs(
      namespace,
      name,
      options,
    );
  },
};
