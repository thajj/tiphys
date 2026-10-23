import React from "react";
import ReactDOM from "react-dom/client";
import type { WorkflowBuilderProps } from "@argocanvas/platform-sdk";
import { PlatformThemeProvider } from "@argocanvas/ui-platform";
import {
  WorkflowBuilderApp,
  createFetchAiClient,
  createFetchDraftsClient,
  createFetchWorkflowTemplatesClient,
  createFetchWorkflowsClient,
  initializeWorkflowRuntime,
} from "@argocanvas/workflow-editor";

const roots = new WeakMap<Element, ReactDOM.Root>();

export function mountWorkflowBuilder(
  container: Element,
  shell: WorkflowBuilderProps,
) {
  let root = roots.get(container);

  if (!root) {
    root = ReactDOM.createRoot(container);
    roots.set(container, root);
  }

  initializeWorkflowRuntime({
    shell,
    clients: {
      workflows: createFetchWorkflowsClient(shell),
      workflowTemplates: createFetchWorkflowTemplatesClient(shell),
      ai: createFetchAiClient(shell),
      drafts: createFetchDraftsClient(shell),
    },
  });

  root.render(
    <React.StrictMode>
      <PlatformThemeProvider>
        <WorkflowBuilderApp shell={shell} />
      </PlatformThemeProvider>
    </React.StrictMode>,
  );
}

export function unmountWorkflowBuilder(container: Element) {
  const root = roots.get(container);
  if (!root) {
    return;
  }

  root.unmount();
  roots.delete(container);
}
