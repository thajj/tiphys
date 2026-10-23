import { fireEvent, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { Position, type EdgeProps } from "reactflow";
import { describe, expect, it, vi } from "vitest";
import DataEdge from "./DataEdge";
import WorkflowEdge, { WorkflowEdgeDeleteContext } from "./WorkflowEdge";

vi.mock("reactflow", async importOriginal => ({
  ...await importOriginal<typeof import("reactflow")>(),
  // React Flow normally supplies this portal container after measuring the
  // canvas, which jsdom cannot do. Keep the real edge geometry and controls.
  EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => createPortal(children, document.body),
}));

const edge: EdgeProps = {
  id: "collect-publish",
  source: "collect",
  target: "publish",
  sourceX: 0,
  sourceY: 0,
  targetX: 200,
  targetY: 100,
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
  selected: true,
};

describe.each([
  ["workflow", WorkflowEdge],
  ["artifact", DataEdge],
] as const)("%s edge controls", (_name, EdgeComponent) => {
  it("does not offer deletion without editor authorization", () => {
    render(<WorkflowEdgeDeleteContext.Provider value={null}><svg><EdgeComponent {...edge} /></svg></WorkflowEdgeDeleteContext.Provider>);
    expect(screen.queryByRole("button", { name: "Delete connection" })).toBeNull();
  });

  it("routes deletion through the editor's graph mutation handler", () => {
    const deleteEdge = vi.fn();
    render(<WorkflowEdgeDeleteContext.Provider value={deleteEdge}><svg><EdgeComponent {...edge} /></svg></WorkflowEdgeDeleteContext.Provider>);
    fireEvent.click(screen.getByRole("button", { name: "Delete connection" }));
    expect(deleteEdge).toHaveBeenCalledExactlyOnceWith("collect-publish");
  });
});
