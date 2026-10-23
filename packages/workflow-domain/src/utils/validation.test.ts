import type { Edge, Node } from "reactflow";
import { describe, expect, it } from "vitest";
import { validateGraphConnectivity } from "./validation";

describe("validateGraphConnectivity", () => {
  it("returns no errors for a connected graph", () => {
    const nodes: Node[] = [
      { id: "a", position: { x: 0, y: 0 }, data: {} },
      { id: "b", position: { x: 1, y: 1 }, data: {} },
    ];
    const edges: Edge[] = [{ id: "a-b", source: "a", target: "b" }];

    expect(validateGraphConnectivity(nodes, edges)).toEqual([]);
  });

  it("flags multiple unconnected steps", () => {
    const nodes: Node[] = [
      { id: "a", position: { x: 0, y: 0 }, data: {} },
      { id: "b", position: { x: 1, y: 1 }, data: {} },
    ];

    expect(validateGraphConnectivity(nodes, [])).toEqual([
      "Workflow has multiple steps but no connections.",
    ]);
  });
});
