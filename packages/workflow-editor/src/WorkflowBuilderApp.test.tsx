import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultFeatureFlags,
  defaultPermissions,
  type WorkflowBuilderProps,
} from "@argocanvas/platform-sdk";
import { PlatformThemeProvider } from "@argocanvas/ui-platform";
import { SimulationEngine, type FlowNodeData, type Workflow } from "@argocanvas/workflow-domain";
import {
  sampleSessions,
  sampleWorkflowRuns,
} from "./testing/fixtures";
import {
  type AiApiClient,
  type DraftsApiClient,
  initializeWorkflowRuntime,
  getWorkflowRuntime,
  createFetchDraftsClient,
  type WorkflowTemplatesApiClient,
  type WorkflowsApiClient,
} from "./platform/runtime";
import { WorkflowBuilderApp, WorkflowBuilderPreviewApp } from "./WorkflowBuilderApp";

function createShell(overrides: Partial<WorkflowBuilderProps> = {}): WorkflowBuilderProps {
  return {
    basePath: "/",
    workspaceId: "test-workspace",
    projectId: "workflow-builder",
    namespaceScope: "ml-platform",
    featureFlags: defaultFeatureFlags,
    permissions: defaultPermissions,
    eventBus: {
      emit: vi.fn(),
    },
    telemetry: {
      track: vi.fn(),
    },
    ...overrides,
  };
}

function initializeTestRuntime(
  shell: WorkflowBuilderProps,
  workflowOverrides: Partial<WorkflowsApiClient> = {},
  draftsOverrides: Partial<DraftsApiClient> = {},
) {
  const workflows: WorkflowsApiClient = {
    async listWorkflowPage() {
      return { items: sampleWorkflowRuns };
    },
    async listWorkflows() {
      return sampleWorkflowRuns;
    },
    async listWorkflowTemplates() {
      return [];
    },
    async submitWorkflow(_namespace, workflow) {
      return workflow;
    },
    async getWorkflow() {
      return undefined;
    },
    async suspendWorkflow() {
      return true;
    },
    async resumeWorkflow() {
      return true;
    },
    async deleteWorkflow() {
      return true;
    },
    async getWorkflowLogs() {
      return "logs";
    },
    async streamWorkflowLogs() {
      throw new Error("stream unavailable");
    },
    ...workflowOverrides,
  };

  const workflowTemplates: WorkflowTemplatesApiClient = {
    async list() {
      return [];
    },
    async get() {
      return undefined;
    },
    async create(_namespace, template) {
      return template;
    },
    async update(_namespace, _name, template) {
      return template;
    },
    async delete() {
      return true;
    },
    async run(_namespace, name) {
      return {
        metadata: { name: `${name}-run`, namespace: shell.namespaceScope },
        spec: { entrypoint: "main", templates: [] },
        status: { phase: "Running" },
      };
    },
  };

  const ai: AiApiClient = {
    async generateWorkflow() {
      return "apiVersion: argoproj.io/v1alpha1";
    },
    async editNode(currentData) {
      return currentData;
    },
    async analyzeWorkflow() {
      return "Analysis complete";
    },
  };

  const drafts: DraftsApiClient = {
    async loadDraft() {
      return {
        sessions: structuredClone(sampleSessions),
        activeSessionId: sampleSessions[0].id,
        savedAt: Date.now(),
      };
    },
    async saveDraft(_workspaceId, _projectId, draft) {
      return draft;
    },
    ...draftsOverrides,
  };

  initializeWorkflowRuntime({
    shell,
    clients: {
      workflows,
      workflowTemplates,
      ai,
      drafts,
    },
  });
}

describe("WorkflowBuilder shell alignment", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("orders slow autosaves and only marks the latest edit as saved", async () => {
    const onDirtyStateChange = vi.fn();
    const shell = createShell({ onDirtyStateChange });
    const completions: Array<() => void> = [];
    const saveDraft = vi.fn((_workspaceId, _projectId, draft) => new Promise<typeof draft>(resolve => { completions.push(() => resolve(draft)); }));
    initializeTestRuntime(shell, {}, { saveDraft });
    render(<PlatformThemeProvider><WorkflowBuilderApp shell={shell} /></PlatformThemeProvider>);
    fireEvent.click(await screen.findByText("Extract Data"));
    const stepName = await screen.findByDisplayValue("Extract Data");
    vi.useFakeTimers();
    fireEvent.change(stepName, { target: { value: "First edit" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(saveDraft).toHaveBeenCalledOnce();

    fireEvent.change(stepName, { target: { value: "Latest edit" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(saveDraft).toHaveBeenCalledOnce();
    await act(async () => completions[0]());

    expect(onDirtyStateChange).not.toHaveBeenCalledWith(false);
    expect(saveDraft).toHaveBeenCalledTimes(2);
    expect(saveDraft.mock.calls[1][2].sessions[0].nodes[0].data.label).toBe("Latest edit");
    await act(async () => completions[1]());
    expect(onDirtyStateChange).toHaveBeenLastCalledWith(false);
  });

  it("does not promise a backup when browser storage and the server both reject a draft", async () => {
    const onDirtyStateChange = vi.fn();
    const shell = createShell({ onDirtyStateChange });
    initializeTestRuntime(shell, {}, { saveDraft: createFetchDraftsClient(shell).saveDraft });
    render(<PlatformThemeProvider><WorkflowBuilderApp shell={shell} /></PlatformThemeProvider>);
    fireEvent.click(await screen.findByText("Extract Data"));
    const stepName = await screen.findByDisplayValue("Extract Data");
    localStorage.clear();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Storage full", "QuotaExceededError"); });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    vi.useFakeTimers();
    fireEvent.change(stepName, { target: { value: "Unsaved change" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    expect(screen.getByText("Draft could not be saved to the server. Keep this tab open and retry when connected.")).toBeTruthy();
    expect(screen.queryByText(/browser backup is retained/i)).toBeNull();
    expect(localStorage.length).toBe(0);
    expect(onDirtyStateChange).not.toHaveBeenCalledWith(false);
    expect(shell.telemetry.track).toHaveBeenCalledWith("drafts.local.save_failed");
  });

  it.each(["New Workflow", "Duplicate"])("preserves current canvas edits when using %s", async (action) => {
    const shell = createShell();
    initializeTestRuntime(shell);
    render(<PlatformThemeProvider><WorkflowBuilderApp shell={shell} /></PlatformThemeProvider>);

    fireEvent.click(await screen.findByText("Extract Data"));
    fireEvent.change(await screen.findByDisplayValue("Extract Data"), { target: { value: "Updated extraction" } });
    fireEvent.click(screen.getByTitle(action));

    if (action === "Duplicate") {
      expect(await screen.findByText("Updated extraction")).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("tab", { name: "Training Pipeline" }));
    expect(await screen.findByText("Updated extraction")).toBeTruthy();
  });

  it("submits directly to Argo without reporting a simulated success", async () => {
    const shell = createShell();
    const simulate = vi.spyOn(SimulationEngine, "simulateNode");
    const submitWorkflow = vi.fn(async (_namespace, workflow) => ({ ...workflow, metadata: { ...workflow.metadata, name: "model-training-live-123" } }));
    initializeTestRuntime(shell, { submitWorkflow });
    render(<PlatformThemeProvider><WorkflowBuilderApp shell={shell} /></PlatformThemeProvider>);

    fireEvent.click(await screen.findByRole("button", { name: "Run" }));

    await waitFor(() => expect(submitWorkflow).toHaveBeenCalledOnce());
    expect(simulate).not.toHaveBeenCalled();
    expect((await screen.findAllByText("Submitted")).length).toBeGreaterThan(0);
    expect(screen.getByText(/model-training-live-123/)).toBeTruthy();
    expect(screen.queryByText("Succeeded")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View runs" }));
    expect(shell.eventBus.emit).toHaveBeenCalledWith({ type: "navigation.requested", to: "workflows", source: "workspace" });
  });

  it("resynchronizes the selected node form after undo restores its data", async () => {
    const shell = createShell();
    initializeTestRuntime(shell);
    render(<PlatformThemeProvider><WorkflowBuilderApp shell={shell} /></PlatformThemeProvider>);
    fireEvent.click(await screen.findByText("Extract Data"));
    fireEvent.change(await screen.findByDisplayValue("python:3.11"), { target: { value: "python:3.12" } });
    fireEvent.click(screen.getByRole("button", { name: "Auto-arrange layout" }));
    fireEvent.change(screen.getByDisplayValue("python:3.12"), { target: { value: "python:3.13" } });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByDisplayValue("python:3.11")).toBeTruthy();
    expect(screen.queryByDisplayValue("python:3.13")).toBeNull();
  });

  it("loads a server draft when browser storage access is blocked", async () => {
    const shell = createShell();
    initializeTestRuntime(shell);
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("Storage blocked", "SecurityError"); });
    render(<PlatformThemeProvider><WorkflowBuilderApp shell={shell} /></PlatformThemeProvider>);
    expect(await screen.findByText("Extract Data")).toBeTruthy();
    fireEvent.click(screen.getByTestId("platform-theme-toggle"));
    expect(screen.getByTestId("platform-theme-provider").getAttribute("data-wb-theme")).toBe("dark");
  });

  it("ignores an old workflow's AI response when a new workflow reuses its node IDs", async () => {
    const shell = createShell();
    initializeTestRuntime(shell);
    let complete!: (data: FlowNodeData) => void;
    getWorkflowRuntime().clients.ai.editNode = vi.fn(() => new Promise<FlowNodeData>(resolve => { complete = resolve; }));
    render(<PlatformThemeProvider><WorkflowBuilderApp shell={shell} /></PlatformThemeProvider>);
    fireEvent.click(await screen.findByText("Extract Data"));
    fireEvent.click(screen.getByRole("button", { name: "Edit with AI" }));
    fireEvent.change(screen.getByPlaceholderText(/^e.g. Change image/), { target: { value: "Upgrade the image" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply AI instruction" }));

    fireEvent.click(screen.getByTitle("Duplicate"));
    fireEvent.click(await screen.findByText("Extract Data"));
    await act(async () => complete({ ...sampleSessions[0].nodes[0].data, label: "AI from original workflow" }));
    expect(screen.getByDisplayValue("Extract Data")).toBeTruthy();
    expect(screen.queryByText("AI from original workflow")).toBeNull();
    expect(screen.queryByDisplayValue("AI from original workflow")).toBeNull();
  });

  it("shows the actual Argo error when submission fails", async () => {
    const shell = createShell();
    initializeTestRuntime(shell, { async submitWorkflow() { throw new Error("Argo denied the workflow service account"); } });
    render(<PlatformThemeProvider><WorkflowBuilderApp shell={shell} /></PlatformThemeProvider>);

    fireEvent.click(await screen.findByRole("button", { name: "Run" }));

    expect(await screen.findByText(/Argo denied the workflow service account/)).toBeTruthy();
    expect(screen.getAllByText("Failed").length).toBeGreaterThan(0);
  });

  it("keeps simulation limited to Dry Run without submitting a workflow", async () => {
    const shell = createShell();
    const simulate = vi.spyOn(SimulationEngine, "simulateNode").mockResolvedValue({ logs: ["simulated step"], duration: 0 });
    const submitWorkflow = vi.fn();
    initializeTestRuntime(shell, { submitWorkflow });
    render(<PlatformThemeProvider><WorkflowBuilderApp shell={shell} /></PlatformThemeProvider>);

    fireEvent.click(await screen.findByRole("button", { name: "Dry run" }));

    expect((await screen.findAllByText("Dry Run Succeeded")).length).toBeGreaterThan(0);
    expect(simulate).toHaveBeenCalledTimes(sampleSessions[0].nodes.length);
    expect(submitWorkflow).not.toHaveBeenCalled();
  });

  it("loads the current Argo revision before replacing a template from a pipeline", async () => {
    const shell = createShell();
    initializeTestRuntime(shell);
    const runtime = getWorkflowRuntime();
    runtime.clients.workflowTemplates.get = vi.fn(async (_namespace, name) => ({
      metadata: { name, namespace: shell.namespaceScope, resourceVersion: "current-revision" },
      spec: { entrypoint: "main", templates: [] },
    }));
    const update = vi.fn(async (_namespace, _name, template) => template);
    runtime.clients.workflowTemplates.update = update;
    render(<PlatformThemeProvider><WorkflowBuilderPreviewApp shell={shell} /></PlatformThemeProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Update template" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(shell.namespaceScope, expect.any(String), expect.objectContaining({ metadata: expect.objectContaining({ resourceVersion: "current-revision" }) })));
  });
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("renders preview chrome and emits future-ready navigation events", async () => {
    const emit = vi.fn();
    const shell = createShell({ eventBus: { emit } });
    initializeTestRuntime(shell);

    render(
      <PlatformThemeProvider>
        <WorkflowBuilderPreviewApp shell={shell} />
      </PlatformThemeProvider>,
    );

    expect(await screen.findByTestId("platform-preview-rail")).toBeTruthy();
    expect(screen.queryByTestId("platform-preview-topbar")).toBeNull();
    expect(screen.getByRole("heading", { name: /model-training/i })).toBeTruthy();

    fireEvent.click(screen.getByTestId("platform-rail-item-workflows"));

    expect(emit).toHaveBeenCalledWith({
      type: "navigation.requested",
      to: "workflows",
      source: "rail",
    });
  });

  it("routes the left-rail profile entry to a dedicated user profile page", async () => {
    const emit = vi.fn();
    const shell = createShell({ eventBus: { emit } });
    initializeTestRuntime(shell);

    render(
      <PlatformThemeProvider>
        <WorkflowBuilderPreviewApp shell={shell} />
      </PlatformThemeProvider>,
    );

    fireEvent.click(await screen.findByTestId("platform-rail-item-profile"));

    expect(await screen.findByRole("heading", { name: "Profile" })).toBeTruthy();
    expect(
      screen.getByText(/Preferences are stored in this browser and reused the next time the builder opens/i),
    ).toBeTruthy();
    expect(screen.getByText("Runtime metadata available to this builder session.")).toBeTruthy();

    expect(emit).toHaveBeenCalledWith({
      type: "navigation.requested",
      to: "profile",
      source: "rail",
    });
  });

  it("removes the dashboard rail entry and redirects stale dashboard routes to pipelines", async () => {
    const emit = vi.fn();
    const shell = createShell({ activeSection: "dashboard", eventBus: { emit } });
    initializeTestRuntime(shell);

    render(
      <PlatformThemeProvider>
        <WorkflowBuilderPreviewApp shell={shell} />
      </PlatformThemeProvider>,
    );

    expect(screen.queryByTestId("platform-rail-item-dashboard")).toBeNull();
    expect(screen.queryByTestId("dashboard-section")).toBeNull();
    expect(await screen.findByTestId("platform-rail-item-pipelines")).toBeTruthy();
    expect(await screen.findByText("Training Pipeline")).toBeTruthy();

    fireEvent.click(screen.getByTestId("platform-rail-item-workflows"));
    expect(await screen.findByTestId("workflows-section")).toBeTruthy();
    expect(emit).toHaveBeenCalledWith({
      type: "navigation.requested",
      to: "workflows",
      source: "rail",
    });
  });

  it("keeps production mounts embedded and preserves editor state across workspace tabs", async () => {
    const shell = createShell();
    initializeTestRuntime(shell);

    render(
      <PlatformThemeProvider>
        <WorkflowBuilderApp shell={shell} />
      </PlatformThemeProvider>,
    );

    expect(await screen.findByText("Training Pipeline")).toBeTruthy();
    expect(screen.queryByTestId("platform-preview-rail")).toBeNull();
    expect(await screen.findByText("Extract Data")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /^Executions$/i }));
    expect(await screen.findByText(/execution logs|no log|logs/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /^Editor$/i }));
    expect(await screen.findByText("Extract Data")).toBeTruthy();
  });

  it("removes the metrics workspace tab from the pipeline editor", async () => {
    const shell = createShell();
    initializeTestRuntime(shell);

    render(
      <PlatformThemeProvider>
        <WorkflowBuilderApp shell={shell} />
      </PlatformThemeProvider>,
    );

    expect(await screen.findByText("Training Pipeline")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /metrics/i })).toBeNull();
  });

  it("removes metrics from the profile workspace preferences", async () => {
    const shell = createShell();
    initializeTestRuntime(shell);

    render(
      <PlatformThemeProvider>
        <WorkflowBuilderPreviewApp shell={shell} />
      </PlatformThemeProvider>,
    );

    fireEvent.click(await screen.findByTestId("platform-rail-item-profile"));

    expect(await screen.findByRole("heading", { name: "Profile" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /metrics/i })).toBeNull();
  });

  it("downgrades stale metrics workspace preferences back to the pipeline view", async () => {
    localStorage.setItem(
      "wb-profile-experience-preferences",
      JSON.stringify({
        preferredHomeSection: "pipelines",
        preferredPipelineView: "metrics",
      }),
    );
    const shell = createShell();
    initializeTestRuntime(shell);

    render(
      <PlatformThemeProvider>
        <WorkflowBuilderApp shell={shell} />
      </PlatformThemeProvider>,
    );

    expect(await screen.findByText("Extract Data")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /metrics/i })).toBeNull();
    expect(screen.getByRole("tab", { name: /^Editor$/i }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("keeps feature-flag and permission notices visible in the cloned shell", async () => {
    const shell = createShell({
      featureFlags: {
        ...defaultFeatureFlags,
        aiAssistant: false,
      },
      permissions: {
        ...defaultPermissions,
        canEditWorkflow: false,
        canSubmitWorkflow: false,
        canUseAI: false,
      },
    });
    initializeTestRuntime(shell);

    render(
      <PlatformThemeProvider>
        <WorkflowBuilderApp shell={shell} />
      </PlatformThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Read-only mode")).toBeTruthy();
      expect(screen.getByText("Submission disabled")).toBeTruthy();
      expect(screen.getByText("AI disabled")).toBeTruthy();
    });
  });

  it("toggles between light and dark platform themes from the builder chrome", async () => {
    const shell = createShell({ activeSection: "pipelines" });
    initializeTestRuntime(shell);

    render(
      <PlatformThemeProvider>
        <WorkflowBuilderApp shell={shell} />
      </PlatformThemeProvider>,
    );

    expect(await screen.findByText("Training Pipeline")).toBeTruthy();

    const themeProvider = screen.getByTestId("platform-theme-provider");
    expect(themeProvider.getAttribute("data-wb-theme")).toBe("light");

    fireEvent.click(screen.getByTestId("platform-theme-toggle"));

    expect(themeProvider.getAttribute("data-wb-theme")).toBe("dark");
  });

  it("surfaces Argo template errors instead of rendering a silent empty state", async () => {
    const shell = createShell();
    initializeTestRuntime(shell, {
      async listWorkflowTemplates() {
        throw new Error("token not valid");
      },
    });

    render(
      <PlatformThemeProvider>
        <WorkflowBuilderApp shell={shell} />
      </PlatformThemeProvider>,
    );

    expect(await screen.findByText("Training Pipeline")).toBeTruthy();

    fireEvent.click(screen.getByTitle("Templates"));

    await waitFor(() => {
      expect(screen.getByText("Templates Unavailable")).toBeTruthy();
      expect(screen.getByText("token not valid")).toBeTruthy();
    });
  });

  it("renders the workflows section in preview mode and opens inspector details", async () => {
    const listWorkflowPage = vi.fn(async (query?: { phases?: string[] }) => {
      const items =
        query?.phases && query.phases.length > 0
          ? sampleWorkflowRuns.filter((workflow) => query.phases?.includes(workflow.status?.phase || ""))
          : sampleWorkflowRuns;
      return {
        items,
        resourceVersion: "42",
      };
    });
    vi.stubEnv("VITE_ARGO_UI_URL", "https://argo.example");
    const shell = createShell();
    initializeTestRuntime(shell, {
      async listWorkflowPage(query) {
        return listWorkflowPage(query);
      },
      async listWorkflows() {
        return sampleWorkflowRuns;
      },
    });

    render(
      <PlatformThemeProvider>
        <WorkflowBuilderPreviewApp shell={shell} />
      </PlatformThemeProvider>,
    );

    fireEvent.click(await screen.findByTestId("platform-rail-item-workflows"));

    expect(await screen.findByRole("heading", { name: "Workflows" })).toBeTruthy();
    expect(await screen.findByTestId("workflow-row-data-runnable-sim-a1b2c", {}, { timeout: 3000 })).toBeTruthy();

    fireEvent.click(screen.getByTestId("workflow-phase-filter-Succeeded"));

    await waitFor(() => {
      expect(listWorkflowPage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          namespace: "ml-platform",
          phases: ["Succeeded"],
        }),
      );
    });

    fireEvent.click(screen.getByTestId("workflow-row-data-runnable-sim-a1b2c"));

    await waitFor(() => {
      expect(screen.getByTestId("workflow-inspector-link").getAttribute("href")).toEqual(
        "https://argo.example/workflows/ml-platform/data-runnable-sim-a1b2c",
      );
    });
  });

  it("omits the native Argo inspector link when VITE_ARGO_UI_URL is unset", async () => {
    const shell = createShell();
    initializeTestRuntime(shell, {
      async listWorkflowPage() {
        return { items: sampleWorkflowRuns, resourceVersion: "42" };
      },
      async listWorkflows() {
        return sampleWorkflowRuns;
      },
    });

    render(
      <PlatformThemeProvider>
        <WorkflowBuilderPreviewApp shell={shell} />
      </PlatformThemeProvider>,
    );

    fireEvent.click(await screen.findByTestId("platform-rail-item-workflows"));
    expect(await screen.findByTestId("workflow-row-data-runnable-sim-a1b2c")).toBeTruthy();
    fireEvent.click(screen.getByTestId("workflow-row-data-runnable-sim-a1b2c"));

    await waitFor(() => {
      expect(screen.queryByTestId("workflow-inspector-link")).toBeNull();
    });
  });

  it("loads additional workflow pages while search is active until a match is found", async () => {
    const pagedClient = vi.fn(async ({ cursor }: { cursor?: string }) => {
      if (!cursor) {
        return {
          items: [sampleWorkflowRuns[0]],
          nextCursor: "page-2",
          resourceVersion: "7",
        };
      }

      return {
        items: [sampleWorkflowRuns[2]],
        resourceVersion: "7",
      };
    });
    const shell = createShell();
    initializeTestRuntime(shell, {
      async listWorkflowPage(query) {
        return pagedClient(query);
      },
      async listWorkflows() {
        return sampleWorkflowRuns;
      },
    });

    render(
      <PlatformThemeProvider>
        <WorkflowBuilderPreviewApp shell={shell} />
      </PlatformThemeProvider>,
    );

    fireEvent.click(await screen.findByTestId("platform-rail-item-workflows"));
    expect(await screen.findByTestId("workflow-row-data-runnable-sim-a1b2c", {}, { timeout: 3000 })).toBeTruthy();

    fireEvent.change(screen.getByTestId("workflows-search-input"), {
      target: { value: "live" },
    });

    await waitFor(() => {
      expect(pagedClient).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: "page-2",
        }),
      );
    });

    expect(await screen.findByTestId("workflow-row-data-runnable-live-g7h8i", {}, { timeout: 3000 })).toBeTruthy();
  });
});
