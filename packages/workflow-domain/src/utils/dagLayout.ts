import dagre from 'dagre';
import { Node, Edge, Position } from 'reactflow';

const DEFAULT_NODE_WIDTH = 220;
const DEFAULT_NODE_HEIGHT = 74;

/**
 * Accurately estimates a node's rendered height based on its payload data,
 * ensuring handles align horizontally across different node variants even before DOM mount.
 */
export const estimateNodeHeight = (node: Node): number => {
  if (node.height && node.height > 0) {
    return node.height;
  }
  const data = node.data;
  if (!data) return DEFAULT_NODE_HEIGHT;
  const hasFooter = Boolean(
    data.container?.image ||
    (data as any).image ||
    data.type === 'http' ||
    data.type === 'sub-workflow' ||
    data.type === 'suspend'
  );
  // Base header is ~48px; with footer image/endpoint/duration it is ~74px
  return hasFooter ? 74 : 48;
};

/**
 * Calculates an optimal hierarchical DAG layout using Dagre.
 */
export const getLayoutedElements = (
  nodes: Node[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'LR',
): { nodes: Node[]; edges: Edge[] } => {
  if (nodes.length === 0) {
    return { nodes: [], edges };
  }

  const isHorizontal = direction === 'LR';
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: isHorizontal ? 50 : 60,
    ranksep: isHorizontal ? 90 : 80,
    marginx: 40,
    marginy: 40,
  });

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  nodes.forEach((node) => {
    const width = node.width || DEFAULT_NODE_WIDTH;
    const height = estimateNodeHeight(node);
    g.setNode(node.id, { width, height });
  });

  edges.forEach((edge) => {
    if (nodeMap.has(edge.source) && nodeMap.has(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  });

  dagre.layout(g);

  const newNodes = nodes.map((node) => {
    const nodeWithPosition = g.node(node.id);
    const width = node.width || DEFAULT_NODE_WIDTH;
    const height = estimateNodeHeight(node);
    // Strip static width/height so React Flow's ResizeObserver measures actual DOM element and registers handleBounds
    const { width: _w, height: _h, ...rest } = node as any;

    return {
      ...rest,
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      position: {
        x: Math.round(nodeWithPosition.x - width / 2),
        y: Math.round(nodeWithPosition.y - height / 2),
      },
    };
  });

  return { nodes: newNodes, edges };
};
