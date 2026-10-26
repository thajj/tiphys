import { MarkerType } from "reactflow";
import type {
  AppEdge,
  AppNode,
  Workflow,
  WorkflowMetadata,
  WorkflowSession,
  WorkflowSpec,
} from "@tiphys/workflow-domain";

const relativeIso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

export const sampleMetadata: WorkflowMetadata = {
  name: "model-training",
  namespace: "ml-platform",
  labels: { team: "mlops" },
};

export const sampleSpec: WorkflowSpec = {
  entrypoint: "main",
  templates: [],
  parallelism: 2,
};

export const sampleNodes: AppNode[] = [
  {
    id: "node-1",
    type: "custom",
    position: { x: 80, y: 40 },
    data: {
      label: "Extract Data",
      type: "container",
      status: "Pending",
      container: {
        image: "python:3.11",
        command: "python extract.py",
        env: [{ name: "BUCKET", value: "raw-datasets" }],
      },
      outputs: {
        artifacts: [{ name: "dataset", path: "/tmp/output.csv" }],
      },
    },
  },
  {
    id: "node-2",
    type: "custom",
    position: { x: 380, y: 40 },
    data: {
      label: "Train Model",
      type: "container",
      status: "Pending",
      container: {
        image: "python:3.11",
        command: "python train.py",
        resources: { limits: { cpu: "2", memory: "4Gi" } },
      },
      inputs: {
        artifacts: [
          {
            name: "dataset",
            path: "/tmp/input.csv",
            from: "{{steps.extract-data.outputs.artifacts.dataset}}",
          },
        ],
      },
    },
  },
];

export const sampleEdges: AppEdge[] = [
  {
    id: "edge-1-2",
    source: "node-1",
    target: "node-2",
    type: "default",
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed },
  },
];

export const sampleSessions: WorkflowSession[] = [
  {
    id: "session-1",
    name: "Training Pipeline",
    nodes: sampleNodes,
    edges: sampleEdges,
    metadata: sampleMetadata,
    spec: sampleSpec,
    updatedAt: Date.now(),
  },
  {
    id: "session-2",
    name: "ETL Pipeline",
    nodes: [],
    edges: [],
    metadata: { name: "etl-pipeline", namespace: "data-platform" },
    spec: { entrypoint: "main", templates: [] },
    updatedAt: Date.now() - 60_000,
  },
];

export const sampleWorkflowRuns: Workflow[] = [
  {
    metadata: {
      name: "data-runnable-sim-a1b2c",
      namespace: "ml-platform",
      uid: "wf-1",
      creationTimestamp: relativeIso(-2 * 60 * 60 * 1000),
      labels: {
        app: "tiphys",
        component: "workflow",
        domain: "data",
      },
      annotations: {
        owner: "platform-team",
      },
    },
    spec: { entrypoint: "main", templates: [] },
    status: {
      phase: "Succeeded",
      startedAt: relativeIso(-(2 * 60 * 60 * 1000 - 30 * 1000)),
      finishedAt: relativeIso(-(2 * 60 * 60 * 1000 - 3 * 60 * 1000)),
      progress: "3/3",
      resourcesDuration: { cpu: 12 },
    },
  },
  {
    metadata: {
      name: "ml-train-run-d4e5f",
      namespace: "ml-platform",
      uid: "wf-2",
      creationTimestamp: relativeIso(-30 * 60 * 60 * 1000),
      labels: {
        app: "tiphys",
        component: "workflow",
        domain: "ml",
      },
    },
    spec: { entrypoint: "train", templates: [] },
    status: {
      phase: "Failed",
      startedAt: relativeIso(-(30 * 60 * 60 * 1000 - 20 * 1000)),
      finishedAt: relativeIso(-(30 * 60 * 60 * 1000 - 6 * 60 * 1000)),
      progress: "1/4",
      resourcesDuration: { cpu: 31 },
    },
  },
  {
    metadata: {
      name: "data-runnable-live-g7h8i",
      namespace: "ml-platform",
      uid: "wf-3",
      creationTimestamp: relativeIso(-45 * 60 * 1000),
      labels: {
        app: "tiphys",
        component: "workflow",
        domain: "data",
      },
    },
    spec: { entrypoint: "main", templates: [] },
    status: {
      phase: "Running",
      startedAt: relativeIso(-(45 * 60 * 1000 - 10 * 1000)),
      progress: "2/5",
      resourcesDuration: { cpu: 7 },
    },
  },
];
