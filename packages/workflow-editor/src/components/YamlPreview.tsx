import { useMemo } from "react";
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
}) => {
  const yamlString = useMemo(() => generateYaml(nodes, edges, metadata, spec), [nodes, edges, metadata, spec]);

  const handleApply = async (nextValue: string) => {
    const parsed = parseYamlToWorkflow(nextValue);
    if (!parsed || !onUpdate) {
      throw new Error("Could not parse YAML or convert it back into the workflow graph.");
    }

    onUpdate(parsed);
  };

  return (
    <YamlDocumentEditor
      title="Workflow Manifest"
      value={yamlString}
      path={modelPath}
      documentId={documentId}
      compact={compact}
      schemaLabel="Official Argo schema"
      helpText="Workflow and WorkflowTemplate validation come from the official Argo JSON schema."
      applyLabel="Apply to pipeline"
      applySuccessMessage="YAML changes were applied to the pipeline graph."
      downloadFileName={`${metadata.name || "workflow"}.yaml`}
      onApply={onUpdate ? handleApply : undefined}
      onClose={onClose}
    />
  );
};

export default YamlPreview;
