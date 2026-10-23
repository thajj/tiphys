import CustomNode from './CustomNode';
import WorkflowEdge from './WorkflowEdge';

export const nodeTypes = {
  custom: CustomNode,
};

export const edgeTypes = {
  default: WorkflowEdge,
  smoothstep: WorkflowEdge,
  data: WorkflowEdge,
};
