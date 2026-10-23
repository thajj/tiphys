import { Node, Edge } from 'reactflow';

/**
 * Checks if the workflow graph is weakly connected (i.e., no disjoint islands).
 * Argo Workflows (DAG templates) allow parallel roots, but generally,
 * a workflow editor implies a single logical unit.
 */
export const validateGraphConnectivity = (nodes: Node[], edges: Edge[]): string[] => {
  if (nodes.length === 0) return [];

  // 1. Build Adjacency List (Treating graph as undirected to check for isolated islands)
  const adj = new Map<string, string[]>();
  nodes.forEach(n => adj.set(n.id, []));

  edges.forEach(e => {
    // We strictly check if nodes exist to avoid crashing on stale edges
    if (adj.has(e.source) && adj.has(e.target)) {
      adj.get(e.source)?.push(e.target);
      adj.get(e.target)?.push(e.source);
    }
  });

  // 2. Traversal to count connected components
  const visited = new Set<string>();
  let components = 0;

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      components++;
      // If we find more than one component, we can stop early if we just want a boolean,
      // but let's count them for the error message.
      if (components > 1) break;

      const stack = [node.id];
      visited.add(node.id);

      while (stack.length > 0) {
        const curr = stack.pop()!;
        const neighbors = adj.get(curr) || [];
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            stack.push(neighbor);
          }
        }
      }
    }
  }

  const errors: string[] = [];
  if (components > 1) {
    errors.push("Workflow is disconnected. All steps must be part of a single flow.");
  }

  // 3. Check for single nodes (orphan nodes with 0 edges) specifically for better error messages
  if (nodes.length > 1 && edges.length === 0) {
      // Overwrite the generic message if we have multiple nodes but NO edges
      return ["Workflow has multiple steps but no connections."];
  }

  return errors;
};
