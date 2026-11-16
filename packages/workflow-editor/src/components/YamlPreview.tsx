import { useEffect, useMemo, useState } from "react";
import * as yaml from "js-yaml";
import type { AppEdge, AppNode, WorkflowMetadata, WorkflowSpec } from "@tiphys/workflow-domain";
import { generateYaml, parseYamlToWorkflow } from "@tiphys/workflow-domain";
import { YamlDocumentEditor } from "./YamlDocumentEditor";
import { yamlModelPaths } from "../yaml/monacoYaml";

interface YamlPreviewProps {
  nodes: AppNode[];
  edges: AppEdge[];
  metadata: WorkflowMetadata;
  spec: WorkflowSpec;
  onUpdate?: (parsed: {
    nodes: AppNode[];
    edges: AppEdge[];
    metadata: WorkflowMetadata;
    spec: WorkflowSpec;
  }) => void;
  onClose?: () => void;
  compact?: boolean;
  modelPath?: string;
  documentId?: string;
  /** Lets the user back out of an edit that blocks export. */
  onUndo?: () => void;
  canUndo?: boolean;
}

const YamlPreview: React.FC<YamlPreviewProps> = ({
  nodes,
  edges,
  metadata,
  spec,
  onUpdate,
  onClose,
  compact,
  modelPath = yamlModelPaths.pipelineInspector,
  documentId,
  onUndo,
  canUndo,
}) => {
  // Imported workflows block export for edits that only YAML can express. There is then no
  // valid manifest for the current graph, so nothing is offered for copy or download as if it were.
  const { yamlString, exportError } = useMemo(() => {
    try {
      return { yamlString: generateYaml(nodes, edges, metadata, spec), exportError: undefined };
    } catch (error) {
      return { yamlString: undefined, exportError: error instanceof Error ? error.message : String(error) };
    }
  }, [nodes, edges, metadata, spec]);
  const importedYaml = spec.editorSource
    ? spec.editorSource.text ?? yaml.dump(spec.editorSource.document, { indent: 2, lineWidth: -1, noRefs: true })
    : undefined;
  const [showImported, setShowImported] = useState(false);
  useEffect(() => { if (!exportError) setShowImported(false); }, [exportError]);

  const handleApply = async (nextValue: string) => {
    const parsed = parseYamlToWorkflow(nextValue);
    if (!parsed || !onUpdate) {
      throw new Error("Could not parse YAML or convert it back into the workflow graph.");
    }

    onUpdate(parsed);
  };

  if (exportError && !(showImported && importedYaml)) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <div
          role="alert"
          className="rounded-xl border border-[rgba(239,68,68,0.28)] bg-[rgba(239,68,68,0.12)] px-3 py-2 text-sm text-[rgb(var(--wb-color-status-error))]"
        >
          {exportError}
        </div>
        <div className="flex flex-wrap gap-2">
          {onUndo && canUndo ? (
            <button
              type="button"
              onClick={onUndo}
              className="rounded-lg border border-[rgb(var(--wb-color-border-strong))] px-3 py-2 text-sm text-[rgb(var(--wb-color-text-primary))]"
            >
              Undo last change
            </button>
          ) : null}
          {importedYaml ? (
            <button
              type="button"
              onClick={() => setShowImported(true)}
              className="rounded-lg border border-[rgb(var(--wb-color-border-strong))] px-3 py-2 text-sm text-[rgb(var(--wb-color-text-primary))]"
            >
              Open imported YAML
            </button>
          ) : null}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[rgb(var(--wb-color-border-strong))] px-3 py-2 text-sm text-[rgb(var(--wb-color-text-primary))]"
            >
              Close
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <YamlDocumentEditor
      title={exportError ? "Imported YAML" : "Workflow Manifest"}
      value={exportError ? importedYaml! : yamlString!}
      path={modelPath}
      documentId={documentId}
      compact={compact}
      schemaLabel="Official Argo schema"
      helpText="Workflow and WorkflowTemplate validation come from the official Argo JSON schema."
      applyLabel="Apply to pipeline"
      applySuccessMessage="YAML changes were applied to the pipeline graph."
      downloadFileName={`${metadata.name || "workflow"}${exportError ? "-imported" : ""}.yaml`}
      onApply={onUpdate ? handleApply : undefined}
      onClose={onClose}
      notice={
        exportError
          ? {
              tone: "warning",
              message: "This is the YAML as imported, without your visual edits. Applying it replaces the current graph.",
            }
          : undefined
      }
    />
  );
};

export default YamlPreview;
