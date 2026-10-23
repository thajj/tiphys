import type { WorkflowTemplateSummary } from "@argocanvas/workflow-domain";
import { getWorkflowRuntime } from "../platform/runtime";

export const platformResourceService = {
  listWorkflowTemplates(namespace?: string) {
    const runtime = getWorkflowRuntime();
    return runtime.clients.workflowTemplates.list(
      namespace || runtime.shell.namespaceScope,
    );
  },

  getWorkflowTemplate(namespace: string, name: string) {
    return getWorkflowRuntime().clients.workflowTemplates.get(namespace, name);
  },

  createWorkflowTemplate(namespace: string, template: WorkflowTemplateSummary) {
    return getWorkflowRuntime().clients.workflowTemplates.create(namespace, template);
  },

  updateWorkflowTemplate(
    namespace: string,
    name: string,
    template: WorkflowTemplateSummary,
  ) {
    return getWorkflowRuntime().clients.workflowTemplates.update(
      namespace,
      name,
      template,
    );
  },

  deleteWorkflowTemplate(namespace: string, name: string) {
    return getWorkflowRuntime().clients.workflowTemplates.delete(namespace, name);
  },

  runWorkflowTemplate(namespace: string, name: string) {
    return getWorkflowRuntime().clients.workflowTemplates.run(namespace, name);
  },
};
