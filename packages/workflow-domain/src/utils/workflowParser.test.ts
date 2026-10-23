import { describe, expect, it } from "vitest";
import { parseYamlToWorkflow } from "./workflowParser";

describe("parseYamlToWorkflow", () => {
  it("parses a simple DAG workflow", () => {
    const result = parseYamlToWorkflow(`
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  name: training-pipeline
  namespace: ml-platform
spec:
  entrypoint: main
  templates:
    - name: main
      dag:
        tasks:
          - name: extract
            template: extract
          - name: train
            template: train
            dependencies: [extract]
    - name: extract
      container:
        image: python:3.11
    - name: train
      container:
        image: python:3.11
`);

    expect(result?.metadata.name).toBe("training-pipeline");
    expect(result?.nodes).toHaveLength(2);
    expect(result?.edges).toHaveLength(1);
  });
});
