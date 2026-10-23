import type { AppEdge, AppNode, FlowNodeData } from "@argocanvas/workflow-domain";
import { getWorkflowRuntime } from "../platform/runtime";

export const geminiService = {
  generateWorkflow: async (description: string): Promise<string> => {
    return getWorkflowRuntime().clients.ai.generateWorkflow(description);
  },

  editNode: async (currentData: FlowNodeData, instruction: string): Promise<FlowNodeData> => {
    return getWorkflowRuntime().clients.ai.editNode(currentData, instruction);
  },

  analyzeWorkflow: async (nodes: AppNode[], edges: AppEdge[]) => {
    return getWorkflowRuntime().clients.ai.analyzeWorkflow(nodes, edges);
  }
};
