import React from 'react';
import ReactDOM from 'react-dom/client';
import "reactflow/dist/style.css";
import "./index.css";
import {
  createConsoleTelemetry,
  createInMemoryEventBus,
  defaultFeatureFlags,
  defaultPermissions,
  type WorkflowBuilderProps,
} from "@tiphys/platform-sdk";
import { PlatformThemeProvider } from "@tiphys/ui-platform";
import {
  WorkflowBuilderPreviewApp,
  createFetchAiClient,
  createFetchDraftsClient,
  createFetchWorkflowTemplatesClient,
  createFetchWorkflowsClient,
  initializeWorkflowRuntime,
} from "@tiphys/workflow-editor";

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

async function start() {
  const response = await fetch("/api/platform/config", { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(response.status === 401 ? "Please sign in to access the workflow builder." : "The workflow builder is unavailable. Please retry.");
  const configuration = await response.json();
  if (import.meta.env.PROD && (!configuration.workspaceId || !configuration.permissions || !configuration.featureFlags)) {
    throw new Error("Production gateway configuration is missing.");
  }
  const standaloneProps: WorkflowBuilderProps = {
    basePath: "/",
    workspaceId: configuration.workspaceId || "local-workspace",
    projectId: configuration.projectId || "workflow-builder",
    namespaceScope: configuration.namespaceScope || "default",
    featureFlags: configuration.featureFlags || defaultFeatureFlags,
    permissions: configuration.permissions || defaultPermissions,
    eventBus: createInMemoryEventBus(),
    telemetry: createConsoleTelemetry(),
  };

  initializeWorkflowRuntime({
    shell: standaloneProps,
    clients: {
      workflows: createFetchWorkflowsClient(standaloneProps),
      workflowTemplates: createFetchWorkflowTemplatesClient(standaloneProps),
      ai: createFetchAiClient(standaloneProps),
      drafts: createFetchDraftsClient(standaloneProps),
    },
  });

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <PlatformThemeProvider>
        <WorkflowBuilderPreviewApp shell={standaloneProps} />
      </PlatformThemeProvider>
    </React.StrictMode>,
  );
}

void start().catch(error => {
  const message = document.createElement("p");
  message.setAttribute("role", "alert");
  message.textContent = error instanceof Error ? error.message : "The workflow builder could not start.";
  rootElement.replaceChildren(message);
});
