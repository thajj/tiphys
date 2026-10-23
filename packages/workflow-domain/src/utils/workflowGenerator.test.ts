import { describe, expect, it } from "vitest";
import { MarkerType } from "reactflow";
import { generateWorkflowObject } from "./workflowGenerator";

describe("generateWorkflowObject", () => {
  it("builds an Argo workflow payload from graph nodes", () => {
    const workflow = generateWorkflowObject(
      [
        {
          id: "extract",
          type: "custom",
          position: { x: 0, y: 0 },
          data: {
            label: "Extract Data",
            type: "container",
            status: "Pending",
            container: { image: "python:3.11", command: "python extract.py" },
          },
        },
        {
          id: "train",
          type: "custom",
          position: { x: 10, y: 10 },
          data: {
            label: "Train Model",
            type: "container",
            status: "Pending",
            container: { image: "python:3.11", command: "python train.py" },
          },
        },
      ],
      [
        {
          id: "edge-1",
          source: "extract",
          target: "train",
          type: "default",
          animated: true,
          markerEnd: { type: MarkerType.ArrowClosed },
        },
      ],
      { name: "training-pipeline", namespace: "ml-platform" },
      { entrypoint: "main", templates: [] },
    );

    expect(workflow.kind).toBe("Workflow");
    expect(workflow.spec.entrypoint).toBe("main");
    expect(workflow.spec.templates[0].dag.tasks).toHaveLength(2);
  });
});
