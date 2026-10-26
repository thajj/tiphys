export type WorkflowBuilderFeatureFlags = {
  aiAssistant: boolean;
  logStreaming: boolean;
  templateLibrary: boolean;
  workflowTemplateManagement?: boolean;
  browserNotifications?: boolean;
};

export type WorkflowBuilderPermissions = {
  canEditWorkflow: boolean;
  canSubmitWorkflow: boolean;
  canUseAI: boolean;
  canViewLogs: boolean;
  canManageWorkflowTemplates?: boolean;
  canOpenNativeArgoUi?: boolean;
};

export type PlatformSectionRoute =
  | "dashboard"
  | "workflows"
  | "pipelines"
  | "profile"
  | "team";

export type PlatformNavigationSource = "rail" | "topbar" | "workspace";

export type WorkflowBuilderEvent =
  | {
      type: "workflow.saved";
      workspaceId: string;
      projectId: string;
      workflowName?: string;
    }
  | {
      type: "workflow.submitted";
      workspaceId: string;
      projectId: string;
      namespace: string;
      workflowName: string;
    }
  | {
      type: "workflow.dirty.changed";
      workspaceId: string;
      projectId: string;
      dirty: boolean;
    }
  | {
      type: "navigation.requested";
      to: PlatformSectionRoute;
      source: PlatformNavigationSource;
    };

export interface PlatformEventBus {
  emit(event: WorkflowBuilderEvent): void;
}

export interface PlatformTelemetry {
  track(eventName: string, payload?: Record<string, unknown>): void;
}

export interface WorkflowBuilderBranding {
  /** Accessible name for the host logo. Defaults to Tiphys. */
  displayName?: string;
  /** Host logo URL. Defaults to the bundled workflow mark. */
  logoUrl?: string;
  /** Optional dark-theme logo URL; falls back to logoUrl when supplied. */
  darkLogoUrl?: string;
}

export interface WorkflowBuilderProps {
  basePath: string;
  workspaceId: string;
  projectId: string;
  namespaceScope: string;
  activeSection?: PlatformSectionRoute;
  /** Optional preview-shell identity; embedded hosts provide their own chrome. */
  branding?: WorkflowBuilderBranding;
  featureFlags: WorkflowBuilderFeatureFlags;
  permissions: WorkflowBuilderPermissions;
  eventBus: PlatformEventBus;
  telemetry: PlatformTelemetry;
  onDirtyStateChange?(dirty: boolean): void;
}

export const defaultFeatureFlags: WorkflowBuilderFeatureFlags = {
  aiAssistant: true,
  logStreaming: true,
  templateLibrary: true,
  workflowTemplateManagement: true,
  browserNotifications: true,
};

export const defaultPermissions: WorkflowBuilderPermissions = {
  canEditWorkflow: true,
  canSubmitWorkflow: true,
  canUseAI: true,
  canViewLogs: true,
  canManageWorkflowTemplates: true,
  canOpenNativeArgoUi: true,
};

export const createConsoleTelemetry = (): PlatformTelemetry => ({
  track(eventName, payload) {
    console.info("[workflow-builder telemetry]", eventName, payload ?? {});
  },
});

export const createInMemoryEventBus = (): PlatformEventBus => ({
  emit(event) {
    console.info("[workflow-builder event]", event);
  },
});
