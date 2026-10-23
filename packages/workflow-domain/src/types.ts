import { Node, Edge } from 'reactflow';

// --- Argo Workflow Types ---

export type WorkflowPhase = 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Error';

export interface WorkflowMetadata {
  name: string;
  namespace: string;
  uid?: string;
  resourceVersion?: string;
  creationTimestamp?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

export interface NameValue {
  name: string;
  value?: string;
  valueFrom?: {
    path?: string;
    parameter?: string;
  };
}

export interface Artifact {
  name: string;
  path: string;
  from?: string; // Reference to another step's output artifact

  // Cloud Storage Definitions
  type?: 'container' | 'gcs' | 's3' | 'git';
  gcs?: {
    bucket: string;
    key: string;
  };
  s3?: {
    bucket: string;
    key: string;
    endpoint?: string;
  };

  archive?: {
      none?: {};
      tar?: {};
      zip?: {};
  }
}

export interface VolumeMount {
  name: string;
  mountPath: string;
}

export interface ResourceRequirements {
  limits?: { cpu?: string; memory?: string };
  requests?: { cpu?: string; memory?: string };
}

export interface RetryStrategy {
  limit?: number;
  retryPolicy?: 'Always' | 'OnFailure' | 'OnError';
  backoff?: {
    duration?: string;
    factor?: number;
    maxDuration?: string;
  };
}

export interface WorkflowSpec {
  entrypoint: string;
  templates: any[];
  activeDeadlineSeconds?: number;
  serviceAccountName?: string;
  securityContext?: Record<string, unknown>;

  // Advanced Workflow Configs
  parallelism?: number;
  podGC?: {
    strategy?: 'OnPodCompletion' | 'OnPodSuccess' | 'OnFailure';
    deleteDelayDuration?: string;
  };
  ttlStrategy?: {
    secondsAfterCompletion?: number;
    secondsAfterSuccess?: number;
    secondsAfterFailure?: number;
  };
  imagePullSecrets?: { name: string }[];
  volumes?: any[];
  arguments?: { parameters?: NameValue[], artifacts?: Artifact[] };
  artifactRepositoryRef?: any;
}

export interface Workflow {
  metadata: WorkflowMetadata;
  spec: WorkflowSpec;
  status?: {
    phase: WorkflowPhase;
    startedAt?: string;
    finishedAt?: string;
    progress?: string;
    resourcesDuration?: Record<string, number>;
  };
}

export interface WorkflowListQuery {
  namespace: string;
  limit?: number;
  cursor?: string;
  phases?: WorkflowPhase[];
  nameEquals?: string;
  fields?: string;
}

export interface WorkflowListPage {
  items: Workflow[];
  nextCursor?: string;
  resourceVersion?: string;
}

export interface WorkflowTemplateSummary {
  apiVersion?: string;
  kind?: "WorkflowTemplate";
  metadata: WorkflowMetadata;
  spec: WorkflowSpec;
  status?: {
    phase?: WorkflowPhase | "Unknown";
    message?: string;
    updatedAt?: string;
  };
  yaml?: string;
}

export interface LogStreamEvent {
  cursor: string;
  message: string;
  timestamp?: string;
}

export interface WorkflowLogStreamChunk {
  events: LogStreamEvent[];
  cursor?: string;
  complete?: boolean;
}

// --- App Internal Types ---

export type NodeType = 'container' | 'script' | 'resource' | 'suspend' | 'http' | 'container-set' | 'sub-workflow';

export interface HttpConfig {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: NameValue[];
  body?: string;
}

export interface ContainerConfig {
  name?: string;
  image: string;
  command?: string;
  // Keep imported argv boundaries until the editor's command text is changed.
  importedCommand?: { text: string; argv: string[] };
  args?: string[];
  securityContext?: Record<string, unknown>;
  env?: NameValue[];
  resources?: ResourceRequirements;
  volumeMounts?: VolumeMount[];
}

export interface FlowControl {
  when?: string; // Conditional execution
  loop?: {
    type: 'withItems' | 'withParam';
    value: string; // JSON string for items or parameter reference
  };
}

export interface ScriptConfig extends Omit<ContainerConfig, 'command' | 'importedCommand'> {
  source: string;
  command?: string[];
  // Imported scripts may intentionally use the image's ENTRYPOINT.
  useImageEntrypoint?: boolean;
}

export interface FlowNodeData {
  label: string;
  type: NodeType;
  description?: string;
  status: WorkflowPhase;

  // Type Specific Config
  container?: ContainerConfig;
  containerSet?: { containers: ContainerConfig[] };
  script?: ScriptConfig;
  resource?: { action: 'create' | 'apply' | 'delete' | 'patch'; manifest: string };
  suspend?: { duration: string };
  http?: HttpConfig;
  subWorkflow?: { workflowId: string; workflowName?: string }; // Reference to another workflow session

  // Cross-cutting concerns
  flowControl?: FlowControl;
  collapsed?: boolean;
  inputs?: {
      parameters?: NameValue[];
      artifacts?: Artifact[];
  };
  outputs?: {
      parameters?: NameValue[];
      artifacts?: Artifact[];
  };

  // Advanced Template Configs
  retryStrategy?: RetryStrategy;
  activeDeadlineSeconds?: number;
  nodeSelector?: NameValue[]; // UI list format
  daemon?: boolean;
}

export type AppNode = Node<FlowNodeData>;
export type AppEdge = Edge;

export interface WorkflowSession {
  id: string;
  name: string;
  nodes: AppNode[];
  edges: AppEdge[];
  metadata: WorkflowMetadata;
  spec: WorkflowSpec;
  updatedAt: number;
}
