import { act, waitFor } from "@testing-library/react";
import { vi, describe, expect, it, beforeEach } from "vitest";
import { createConsoleTelemetry, createInMemoryEventBus, defaultFeatureFlags, defaultPermissions } from "@tiphys/platform-sdk";
import { mountWorkflowBuilder, unmountWorkflowBuilder } from "./public-api";

vi.mock("@tiphys/workflow-editor", () => ({
  WorkflowBuilderApp: ({ shell }: { shell: { projectId: string } }) => <div>Mounted {shell.projectId}</div>,
  WorkflowBuilderPreviewApp: () => <div>Preview shell</div>,
  createFetchAiClient: () => ({}),
  createFetchDraftsClient: () => ({ loadDraft: async () => null, saveDraft: async (workspaceId: string, projectId: string, draft: unknown) => draft }),
  createFetchWorkflowTemplatesClient: () => ({}),
  createFetchWorkflowsClient: () => ({}),
  initializeWorkflowRuntime: () => undefined,
}));

describe("mountWorkflowBuilder", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("mounts and unmounts the workflow builder shell", async () => {
    const container = document.getElementById("root")!;

    await act(async () => {
      mountWorkflowBuilder(container, {
        basePath: "/",
        workspaceId: "workspace",
        projectId: "project",
        namespaceScope: "default",
        featureFlags: defaultFeatureFlags,
        permissions: defaultPermissions,
        eventBus: createInMemoryEventBus(),
        telemetry: createConsoleTelemetry(),
      });
    });

    await waitFor(() => {
      expect(container.textContent).toContain("Mounted project");
      expect(container.textContent).not.toContain("Preview shell");
    });

    await act(async () => {
      unmountWorkflowBuilder(container);
    });

    expect(container.textContent).toBe("");
  });
});
