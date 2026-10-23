import "./monacoSetup";
import type { Monaco } from "@monaco-editor/react";
import { configureMonacoYaml, type JSONSchema, type MonacoYaml } from "monaco-yaml";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import YamlWorker from "./yaml.worker?worker";

const OFFICIAL_ARGO_WORKFLOW_SCHEMA_URI =
  "/schemas/argo-workflows.json";

export const yamlModelPaths = {
  pipelineInspector: "file:///workflow.pipeline-inspector.yaml",
  workflowTemplate: "file:///workflow-template.editor.yaml",
  resourceManifest: "file:///resource.manifest.yaml",
} as const;

let yamlInstance: MonacoYaml | null = null;
let monacoWorkersConfigured = false;

type MonacoWorkerEnvironment = {
  getWorker: (moduleId: string, label: string) => Worker;
};

const yamlSchemas: Array<{
  fileMatch: string[];
  uri: string;
  schema?: JSONSchema;
}> = [
  {
    fileMatch: ["file:///workflow*.yaml", "file:///workflow-template*.yaml"],
    uri: OFFICIAL_ARGO_WORKFLOW_SCHEMA_URI,
  },
];

const configureMonacoWorkers = () => {
  if (monacoWorkersConfigured || typeof globalThis === "undefined") {
    return;
  }

  const monacoEnvironment: MonacoWorkerEnvironment = {
    getWorker(_moduleId: string, label: string) {
      if (label === "json") {
        return new JsonWorker();
      }
      if (label === "yaml") {
        return new YamlWorker();
      }
      return new EditorWorker();
    },
  };

  (
    globalThis as typeof globalThis & {
      MonacoEnvironment?: MonacoWorkerEnvironment;
    }
  ).MonacoEnvironment = monacoEnvironment;

  monacoWorkersConfigured = true;
};

export const ensureMonacoYaml = (monaco: Monaco) => {
  configureMonacoWorkers();

  if (!yamlInstance) {
    yamlInstance = configureMonacoYaml(monaco, {
      completion: true,
      enableSchemaRequest: true,
      format: {},
      hover: true,
      isKubernetes: true,
      // The language server resolves the schema's internal $refs against this
      // URI. A root-relative URI fetches successfully but breaks ref resolution.
      schemas: yamlSchemas.map(schema => ({ ...schema, uri: new URL(schema.uri, window.location.href).href })),
      validate: true,
      yamlVersion: "1.2",
    });
  }

  return yamlInstance;
};

configureMonacoWorkers();
