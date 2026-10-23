import { AppNode, AppEdge } from '../types';

/**
 * A simple simulation engine that traverses the DAG and provides execution steps
 */
export class SimulationEngine {
  private nodes: AppNode[];
  private edges: AppEdge[];
  private visited: Set<string> = new Set();
  private inDegree: Map<string, number> = new Map();
  private adjacencyList: Map<string, string[]> = new Map();

  constructor(nodes: AppNode[], edges: AppEdge[]) {
    this.nodes = nodes;
    this.edges = edges;
    this.initGraph();
  }

  private initGraph() {
    this.nodes.forEach(node => {
      this.inDegree.set(node.id, 0);
      this.adjacencyList.set(node.id, []);
    });

    this.edges.forEach(edge => {
      const source = edge.source;
      const target = edge.target;

      if (this.adjacencyList.has(source) && this.adjacencyList.has(target)) {
        this.adjacencyList.get(source)!.push(target);
        this.inDegree.set(target, (this.inDegree.get(target) || 0) + 1);
      }
    });
  }

  /**
   * Returns nodes in topological order (grouped by parallel execution levels)
   */
  public getExecutionPlan(): string[][] {
    const plan: string[][] = [];
    const currentInDegree = new Map(this.inDegree);
    const queue: string[] = [];

    // Initial nodes (in-degree 0)
    this.nodes.forEach(node => {
      if (currentInDegree.get(node.id) === 0) {
        queue.push(node.id);
      }
    });

    while (queue.length > 0) {
      const level: string[] = [...queue];
      plan.push(level);
      queue.length = 0;

      level.forEach(nodeId => {
        const neighbors = this.adjacencyList.get(nodeId) || [];
        neighbors.forEach(neighbor => {
          const degree = (currentInDegree.get(neighbor) || 0) - 1;
          currentInDegree.set(neighbor, degree);
          if (degree === 0) {
            queue.push(neighbor);
          }
        });
      });
    }

    return plan;
  }

  /**
   * Simulates a single node execution
   */
  public static async simulateNode(node: AppNode): Promise<{ logs: string[]; duration: number }> {
    const d = node.data;
    const duration = d.type === 'suspend' ? (parseInt(d.suspend?.duration || '2') * 1000) : 1000 + Math.random() * 1500;

    const logs: string[] = [
      `[INFO] Starting step: ${d.label}`,
      `[INFO] Type: ${d.type}`,
    ];

    if (d.type === 'container' && d.container) {
      logs.push(`[INFO] Pulling image: ${d.container.image}`);
      logs.push(`[INFO] Executing command: ${d.container.command || 'default'}`);
    } else if (d.type === 'script' && d.script) {
      logs.push(`[INFO] Initializing ${d.script.image} environment`);
      logs.push(`[INFO] Running source code...`);
    } else if (d.type === 'http' && d.http) {
      logs.push(`[INFO] Sending ${d.http.method} request to ${d.http.url}`);
    } else if (d.type === 'suspend') {
      logs.push(`[INFO] Suspending for ${d.suspend?.duration || '2s'}...`);
    }

    return new Promise(resolve => {
      setTimeout(() => {
        logs.push(`[SUCCESS] Step ${d.label} completed.`);
        resolve({ logs, duration });
      }, duration);
    });
  }
}
