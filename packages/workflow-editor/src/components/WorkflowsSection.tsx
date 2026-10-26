import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as yaml from "js-yaml";
import type {
  Workflow,
  WorkflowListQuery,
  WorkflowPhase,
  WorkflowTemplateSummary,
} from "@tiphys/workflow-domain";
import {
  Button,
  PlatformEmptyState,
  PlatformInspectorFrame,
  PlatformStatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
} from "@tiphys/ui-platform";
import {
  Activity,
  ArrowUpRight,
  FolderCog,
  Play,
  Plus,
  RefreshCcw,
  Save,
  Search,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import type { BrowserNotificationPreferences } from "../platform/notificationPreferences";
import { sendBrowserNotification } from "../platform/notificationPreferences";
import { getWorkflowRuntime } from "../platform/runtime";
import { argoService } from "../services/argoService";
import { platformResourceService } from "../services/platformResourceService";
import { RunDetailsPanel } from "./RunDetailsPanel";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { YamlDocumentEditor } from "./YamlDocumentEditor";
import { yamlModelPaths } from "../yaml/monacoYaml";

const PHASE_OPTIONS: WorkflowPhase[] = ["Pending", "Running", "Succeeded", "Failed", "Error"];
const yamlOptions = { indent: 2, lineWidth: -1, noRefs: true } as const;

type WorkflowsSectionProps = {
  namespace: string;
  notificationPreferences?: BrowserNotificationPreferences;
};

type OperationsTab = "runs" | "templates";

const textInputClass =
  "h-9 w-full rounded-md border border-[rgb(var(--wb-color-border-subtle)/0.7)] bg-[rgb(var(--wb-color-bg-base))] px-3 text-sm text-[rgb(var(--wb-color-text-primary))] outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--wb-color-accent-primary)/0.35)]";

const formatRelativeTime = (value?: string) => {
  if (!value) {
    return "Unknown";
  }

  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) {
    return "Unknown";
  }

  const deltaSeconds = Math.max(1, Math.round((Date.now() - parsed) / 1000));
  if (deltaSeconds < 60) {
    return `${deltaSeconds}s ago`;
  }

  const minutes = Math.round(deltaSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.round(hours / 24);
  return `${days}d ago`;
};

const getStatusTone = (phase?: string): "default" | "success" | "warning" | "danger" | "info" => {
  if (phase === "Succeeded" || phase === "Enabled") {
    return "success";
  }
  if (phase === "Failed" || phase === "Error" || phase === "Disabled") {
    return "danger";
  }
  if (phase === "Running" || phase === "Submitted") {
    return "info";
  }
  if (phase === "Pending") {
    return "warning";
  }
  return "default";
};

const getArgoUiBase = () => `${import.meta.env.VITE_ARGO_UI_URL || ""}`.replace(/\/+$/, "");

const createArgoWorkflowHref = (workflow: Workflow) => {
  const base = getArgoUiBase();
  const path = `/workflows/${encodeURIComponent(workflow.metadata.namespace)}/${encodeURIComponent(workflow.metadata.name)}`;
  return base ? `${base}${path}` : path;
};

const createBlankTemplate = (namespace: string): WorkflowTemplateSummary => ({
  apiVersion: "argoproj.io/v1alpha1",
  kind: "WorkflowTemplate",
  metadata: {
    name: "new-template",
    namespace,
    annotations: {
      description: "End-user managed workflow template",
    },
  },
  spec: {
    entrypoint: "main",
    templates: [],
  },
});

const dedupeWorkflows = (items: Workflow[]) => {
  const seen = new Map<string, Workflow>();
  for (const item of items) {
    seen.set(`${item.metadata.namespace}/${item.metadata.name}`, item);
  }
  return Array.from(seen.values());
};

const workflowMatchesSearch = (workflow: Workflow, search: string) => {
  if (!search) {
    return true;
  }

  const haystack = [
    workflow.metadata.name,
    workflow.metadata.namespace,
    ...Object.entries(workflow.metadata.labels || {}).map(([key, value]) => `${key}=${value}`),
    ...Object.entries(workflow.metadata.annotations || {}).map(([key, value]) => `${key}=${value}`),
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(search);
};

const getWorkflowOutputUri = (workflow: Workflow) => {
  const annotated = workflow.metadata.annotations?.["tiphys/output-uri"];
  if (annotated) {
    return annotated;
  }

  const nodes = (
    workflow.status as
      | {
          nodes?: Record<
            string,
            { outputs?: { parameters?: Array<{ name: string; value?: string }> } }
          >;
        }
      | undefined
  )?.nodes;

  if (!nodes) {
    return undefined;
  }

  for (const node of Object.values(nodes)) {
    for (const parameter of node.outputs?.parameters || []) {
      if (parameter.name === "expected_output_uri" && parameter.value) {
        return parameter.value;
      }
    }
  }

  return undefined;
};

const toTemplateYaml = (template: WorkflowTemplateSummary) => yaml.dump(template, yamlOptions);

const parseTemplateYaml = (
  namespace: string,
  source: string,
  fallback: WorkflowTemplateSummary,
): WorkflowTemplateSummary => {
  const parsed = (yaml.load(source) as Partial<WorkflowTemplateSummary> | undefined) || {};
  return {
    apiVersion: parsed.apiVersion || "argoproj.io/v1alpha1",
    kind: "WorkflowTemplate",
    metadata: {
      ...fallback.metadata,
      ...(parsed.metadata || {}),
      namespace,
      name: parsed.metadata?.name || fallback.metadata.name,
    },
    spec: {
      ...fallback.spec,
      ...(parsed.spec || {}),
      entrypoint: parsed.spec?.entrypoint || fallback.spec.entrypoint,
      templates: parsed.spec?.templates || fallback.spec.templates,
    },
    status: parsed.status || fallback.status,
    yaml: source,
  };
};

export function WorkflowsSection(props: WorkflowsSectionProps) {
  const runtime = getWorkflowRuntime();
  const canOpenNativeArgoUi =
    !!getArgoUiBase() && runtime.shell.permissions.canOpenNativeArgoUi !== false;
  const canManageWorkflowTemplates =
    runtime.shell.featureFlags.workflowTemplateManagement !== false &&
    runtime.shell.permissions.canManageWorkflowTemplates !== false;

  const [activeTab, setActiveTab] = useState<OperationsTab>("runs");
  const [searchInput, setSearchInput] = useState("");
  const [selectedPhases, setSelectedPhases] = useState<WorkflowPhase[]>([]);
  const [loadedWorkflows, setLoadedWorkflows] = useState<Workflow[]>([]);
  const [selectedWorkflowName, setSelectedWorkflowName] = useState<string | null>(null);
  const [workflowsLoading, setWorkflowsLoading] = useState(true);
  const [workflowsError, setWorkflowsError] = useState<string | null>(null);

  const [workflowTemplates, setWorkflowTemplates] = useState<WorkflowTemplateSummary[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templateActionError, setTemplateActionError] = useState<string | null>(null);
  const [selectedTemplateName, setSelectedTemplateName] = useState<string | null>(null);
  const [templateDraft, setTemplateDraft] = useState<WorkflowTemplateSummary>(() =>
    createBlankTemplate(props.namespace),
  );
  const [templateYaml, setTemplateYaml] = useState(() =>
    toTemplateYaml(createBlankTemplate(props.namespace)),
  );

  const [confirmationDialog, setConfirmationDialog] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    tone?: "danger" | "warning" | "info";
    onConfirm: () => void | Promise<void>;
  } | null>(null);

  const previousWorkflowStatusRef = useRef<Record<string, string>>({});
  const normalizedSearch = useMemo(() => searchInput.trim().toLowerCase(), [searchInput]);

  const applyTemplateDraft = useCallback((next: WorkflowTemplateSummary) => {
    setTemplateDraft(next);
    setTemplateYaml(toTemplateYaml(next));
  }, []);

  const loadRuns = useCallback(async () => {
    setWorkflowsLoading(true);
    setWorkflowsError(null);
    try {
      const items: Workflow[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await argoService.listWorkflowPage({
          namespace: props.namespace,
          limit: 50,
          phases: selectedPhases,
          cursor,
        } satisfies WorkflowListQuery);
        items.push(...page.items);
        cursor = page.nextCursor;
        pages += 1;
        if (!normalizedSearch) {
          break;
        }
        const matched = items.some((workflow) => workflowMatchesSearch(workflow, normalizedSearch));
        if (matched || !cursor || pages >= 10) {
          break;
        }
      } while (cursor);
      setLoadedWorkflows(dedupeWorkflows(items));
    } catch (error) {
      setLoadedWorkflows([]);
      setWorkflowsError(error instanceof Error ? error.message : "Failed to load workflow runs.");
    } finally {
      setWorkflowsLoading(false);
    }
  }, [normalizedSearch, props.namespace, selectedPhases]);

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    setTemplatesError(null);
    try {
      setWorkflowTemplates(await platformResourceService.listWorkflowTemplates(props.namespace));
    } catch (error) {
      setWorkflowTemplates([]);
      setTemplatesError(error instanceof Error ? error.message : "Failed to load workflow templates.");
    } finally {
      setTemplatesLoading(false);
    }
  }, [props.namespace]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    if (activeTab === "templates") {
      void loadTemplates();
    }
  }, [activeTab, loadTemplates]);

  useEffect(() => {
    if (activeTab !== "runs") {
      return;
    }

    const interval = window.setInterval(() => {
      void loadRuns();
    }, 10000);

    return () => window.clearInterval(interval);
  }, [activeTab, loadRuns]);

  const selectedWorkflow = useMemo(
    () =>
      loadedWorkflows.find((workflow) => workflow.metadata.name === selectedWorkflowName) || null,
    [loadedWorkflows, selectedWorkflowName],
  );
  const selectedTemplate = useMemo(
    () =>
      workflowTemplates.find((template) => template.metadata.name === selectedTemplateName) ||
      null,
    [selectedTemplateName, workflowTemplates],
  );
  useEffect(() => {
    if (selectedTemplate) {
      applyTemplateDraft(selectedTemplate);
    } else if (!selectedTemplateName) {
      applyTemplateDraft(createBlankTemplate(props.namespace));
    }
  }, [applyTemplateDraft, props.namespace, selectedTemplate, selectedTemplateName]);

  useEffect(() => {
    if (!props.notificationPreferences) {
      return;
    }

    for (const workflow of loadedWorkflows) {
      const key = `${workflow.metadata.namespace}/${workflow.metadata.name}`;
      const previous = previousWorkflowStatusRef.current[key];
      const next = workflow.status?.phase || "Unknown";
      if (
        previous &&
        previous !== next &&
        (next === "Succeeded" || next === "Failed" || next === "Error")
      ) {
        sendBrowserNotification(
          props.notificationPreferences,
          next === "Succeeded" ? "workflowSucceeded" : "workflowFailed",
          {
            title: next === "Succeeded" ? "Workflow completed" : "Workflow needs attention",
            body: `${workflow.metadata.name} is now ${next}.`,
            tag: `workflow:${key}:${next}`,
          },
        );
      }
      previousWorkflowStatusRef.current[key] = next;
    }
  }, [loadedWorkflows, props.notificationPreferences]);

  const filteredWorkflows = useMemo(
    () => loadedWorkflows.filter((workflow) => workflowMatchesSearch(workflow, normalizedSearch)),
    [loadedWorkflows, normalizedSearch],
  );
  const openConfirmation = useCallback(
    (config: {
      title: string;
      message: string;
      confirmLabel: string;
      tone?: "danger" | "warning" | "info";
      onConfirm: () => void | Promise<void>;
    }) => {
      setConfirmationDialog(config);
    },
    [],
  );

  const handleResubmitWorkflow = async (workflow: Workflow) => {
    const nextWorkflow = {
      ...workflow,
      metadata: {
        ...workflow.metadata,
        name: undefined,
        generateName: `${workflow.metadata.name}-`,
      },
      status: undefined,
    } as unknown as Workflow;

    await argoService.submitWorkflow(workflow.metadata.namespace, nextWorkflow);
    await loadRuns();
  };

  const handleTemplateYamlApply = async (nextYaml: string) => {
    const nextTemplate = parseTemplateYaml(props.namespace, nextYaml, templateDraft);
    applyTemplateDraft(nextTemplate);
  };

  const handleTemplateSave = async () => {
    setTemplateActionError(null);
    try {
      if (selectedTemplate) {
        await platformResourceService.updateWorkflowTemplate(
          props.namespace,
          selectedTemplate.metadata.name,
          templateDraft,
        );
      } else {
        await platformResourceService.createWorkflowTemplate(props.namespace, templateDraft);
        setSelectedTemplateName(templateDraft.metadata.name);
      }
      await loadTemplates();
    } catch (error) {
      setTemplateActionError(error instanceof Error ? error.message : "Failed to save template.");
    }
  };

  const handleTemplateRun = async (name: string) => {
    setTemplateActionError(null);
    try {
      await platformResourceService.runWorkflowTemplate(props.namespace, name);
      setActiveTab("runs");
      await loadRuns();
    } catch (error) {
      setTemplateActionError(error instanceof Error ? error.message : "Failed to run template.");
    }
  };

  const tabs = [
    { id: "runs" as const, label: "Runs", icon: <Activity size={14} /> },
    { id: "templates" as const, label: "Templates", icon: <FolderCog size={14} /> },
  ];

  const resourcePanelError = (message: string) => (
    <div className="rounded-md border border-[rgb(var(--wb-color-status-error)/0.28)] bg-[rgb(var(--wb-color-status-error)/0.1)] px-3 py-2 text-sm text-[rgb(var(--wb-color-status-error))]">
      {message}
    </div>
  );

  return (
    <>
      <div
        data-testid="workflows-section"
        className="flex h-full min-h-0 flex-1 overflow-hidden bg-[rgb(var(--wb-color-bg-base))]"
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-[rgb(var(--wb-color-border-subtle)/0.72)] px-4">
            <div className="flex min-w-0 items-center gap-3">
              <h1 className="truncate text-base font-semibold">Workflows</h1>
              <div className="flex items-center gap-1 rounded-md border border-[rgb(var(--wb-color-border-subtle)/0.7)] p-0.5">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => startTransition(() => setActiveTab(tab.id))}
                    className={`inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-xs font-semibold transition-colors ${
                      activeTab === tab.id
                        ? "bg-[rgb(var(--wb-color-accent-primary)/0.14)] text-[rgb(var(--wb-color-accent-primary))]"
                        : "text-[rgb(var(--wb-color-text-secondary))] hover:text-[rgb(var(--wb-color-text-primary))]"
                    }`}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {activeTab === "runs" ? (
                <>
                  <div className="relative w-64 max-w-[40vw]">
                    <Search
                      size={14}
                      className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[rgb(var(--wb-color-text-muted))]"
                    />
                    <input
                      data-testid="workflows-search-input"
                      value={searchInput}
                      onChange={(event) => setSearchInput(event.target.value)}
                      placeholder="Search runs…"
                      className="h-8 w-full rounded-md border border-[rgb(var(--wb-color-border-subtle)/0.7)] bg-[rgb(var(--wb-color-bg-base))] py-0 pl-8 pr-3 text-sm outline-none"
                    />
                  </div>
                  <Tooltip label="Refresh runs" side="bottom">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label="Refresh runs"
                      onClick={() => void loadRuns()}
                    >
                      <RefreshCcw size={14} />
                    </Button>
                  </Tooltip>
                </>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSelectedTemplateName(null);
                    applyTemplateDraft(createBlankTemplate(props.namespace));
                  }}
                  disabled={!canManageWorkflowTemplates}
                >
                  <Plus size={14} />
                  New template
                </Button>
              )}
            </div>
          </div>

          {activeTab === "runs" ? (
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="flex flex-wrap gap-1.5 border-b border-[rgb(var(--wb-color-border-subtle)/0.56)] px-4 py-2">
                  {PHASE_OPTIONS.map((phase) => {
                    const active = selectedPhases.includes(phase);
                    return (
                      <button
                        key={phase}
                        type="button"
                        data-testid={`workflow-phase-filter-${phase}`}
                        onClick={() =>
                          setSelectedPhases((previous) =>
                            previous.includes(phase)
                              ? previous.filter((value) => value !== phase)
                              : [...previous, phase],
                          )
                        }
                        className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${
                          active
                            ? "border-[rgb(var(--wb-color-accent-primary)/0.45)] bg-[rgb(var(--wb-color-accent-primary)/0.12)] text-[rgb(var(--wb-color-accent-primary))]"
                            : "border-[rgb(var(--wb-color-border-subtle)/0.7)] text-[rgb(var(--wb-color-text-secondary))]"
                        }`}
                      >
                        {phase}
                      </button>
                    );
                  })}
                </div>

                {workflowsLoading ? (
                  <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-[rgb(var(--wb-color-text-secondary))]">
                    Loading workflow runs…
                  </div>
                ) : workflowsError ? (
                  <div className="p-4">
                    <div
                      data-testid="workflow-error-banner"
                      className="rounded-md border border-[rgb(var(--wb-color-status-error)/0.28)] bg-[rgb(var(--wb-color-status-error)/0.1)] px-3 py-2 text-sm text-[rgb(var(--wb-color-status-error))]"
                    >
                      {workflowsError}
                    </div>
                  </div>
                ) : filteredWorkflows.length === 0 ? (
                  <div className="flex min-h-0 flex-1 items-center justify-center p-4">
                    <PlatformEmptyState
                      icon={<Activity size={28} />}
                      title="No workflow runs match the current filters"
                      body="Broaden the search or phase filters, or submit a workflow from Pipelines."
                    />
                  </div>
                ) : (
                  <div className="custom-scrollbar min-h-0 flex-1 overflow-auto">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-[rgb(var(--wb-color-bg-surface))]">
                        <TableRow className="hover:bg-transparent">
                          <TableHead>Name</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Namespace</TableHead>
                          <TableHead>Created</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredWorkflows.map((workflow) => (
                          <TableRow
                            key={workflow.metadata.uid || workflow.metadata.name}
                            data-testid={`workflow-row-${workflow.metadata.name}`}
                            data-state={
                              selectedWorkflowName === workflow.metadata.name ? "selected" : undefined
                            }
                            className="cursor-pointer"
                            onClick={() => setSelectedWorkflowName(workflow.metadata.name)}
                          >
                            <TableCell className="max-w-[20rem] truncate font-medium">
                              <button
                                type="button"
                                aria-label={`Inspect workflow ${workflow.metadata.name}`}
                                aria-pressed={selectedWorkflowName === workflow.metadata.name}
                                className="max-w-full truncate rounded-sm text-left outline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgb(var(--wb-color-accent-primary))]"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedWorkflowName(workflow.metadata.name);
                                }}
                              >
                                {workflow.metadata.name}
                              </button>
                            </TableCell>
                            <TableCell>
                              <PlatformStatusBadge tone={getStatusTone(workflow.status?.phase)}>
                                {workflow.status?.phase || "Unknown"}
                              </PlatformStatusBadge>
                            </TableCell>
                            <TableCell className="text-[rgb(var(--wb-color-text-secondary))]">
                              {workflow.metadata.namespace}
                            </TableCell>
                            <TableCell className="text-[rgb(var(--wb-color-text-secondary))]">
                              {formatRelativeTime(workflow.metadata.creationTimestamp)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              {selectedWorkflow ? (
                <PlatformInspectorFrame
                  tabs={[{ id: "overview", label: "Run detail", icon: <Activity size={14} /> }]}
                  activeTab="overview"
                  onTabChange={() => undefined}
                  onClose={() => setSelectedWorkflowName(null)}
                  width="min(100%, 28rem)"
                >
                  <RunDetailsPanel
                    title="Workflow Run"
                    workflowName={selectedWorkflow.metadata.name}
                    namespace={selectedWorkflow.metadata.namespace}
                    status={selectedWorkflow.status?.phase}
                    startedAt={
                      selectedWorkflow.status?.startedAt ||
                      selectedWorkflow.metadata.creationTimestamp
                    }
                    updatedAt={
                      selectedWorkflow.status?.finishedAt ||
                      selectedWorkflow.metadata.creationTimestamp
                    }
                    outputUri={getWorkflowOutputUri(selectedWorkflow)}
                    canViewLogs={runtime.shell.permissions.canViewLogs}
                    actions={
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void handleResubmitWorkflow(selectedWorkflow)}
                        >
                          <Play size={14} fill="currentColor" />
                          Resubmit
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void (selectedWorkflow.status?.phase === "Running"
                              ? argoService.suspendWorkflow(
                                  selectedWorkflow.metadata.namespace,
                                  selectedWorkflow.metadata.name,
                                )
                              : argoService.resumeWorkflow(
                                  selectedWorkflow.metadata.namespace,
                                  selectedWorkflow.metadata.name,
                                )
                            ).then(loadRuns)
                          }
                        >
                          {selectedWorkflow.status?.phase === "Running" ? "Suspend" : "Resume"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            openConfirmation({
                              title: "Delete workflow run?",
                              message: `This permanently removes ${selectedWorkflow.metadata.name} from namespace ${selectedWorkflow.metadata.namespace}.`,
                              confirmLabel: "Delete run",
                              tone: "danger",
                              onConfirm: async () => {
                                await argoService.deleteWorkflow(
                                  selectedWorkflow.metadata.namespace,
                                  selectedWorkflow.metadata.name,
                                );
                                setSelectedWorkflowName(null);
                                setConfirmationDialog(null);
                                await loadRuns();
                              },
                            })
                          }
                          className="text-[rgb(var(--wb-color-status-error))]"
                        >
                          <Trash2 size={14} />
                          Delete
                        </Button>
                        {canOpenNativeArgoUi ? (
                          <a
                            data-testid="workflow-inspector-link"
                            href={createArgoWorkflowHref(selectedWorkflow)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[rgb(var(--wb-color-border-subtle)/0.9)] px-2.5 text-sm font-semibold text-[rgb(var(--wb-color-text-secondary))]"
                          >
                            Open in Argo
                            <ArrowUpRight size={14} />
                          </a>
                        ) : null}
                      </div>
                    }
                  />
                </PlatformInspectorFrame>
              ) : null}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                {templatesLoading ? (
                  <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-[rgb(var(--wb-color-text-secondary))]">
                    Loading templates…
                  </div>
                ) : templatesError ? (
                  <div className="p-4 text-sm text-[rgb(var(--wb-color-status-error))]">{templatesError}</div>
                ) : workflowTemplates.length === 0 ? (
                  <div className="flex min-h-0 flex-1 items-center justify-center p-4">
                    <PlatformEmptyState
                      icon={<FolderCog size={28} />}
                      title="No workflow templates yet"
                      body="Publish one from Pipelines or create a new namespaced template in the side panel."
                    />
                  </div>
                ) : (
                  <div className="custom-scrollbar min-h-0 flex-1 overflow-auto">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-[rgb(var(--wb-color-bg-surface))]">
                        <TableRow className="hover:bg-transparent">
                          <TableHead>Name</TableHead>
                          <TableHead>Entrypoint</TableHead>
                          <TableHead className="w-28">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {workflowTemplates.map((template) => (
                          <TableRow
                            key={template.metadata.name}
                            data-state={
                              selectedTemplateName === template.metadata.name ? "selected" : undefined
                            }
                            className="cursor-pointer"
                            onClick={() => setSelectedTemplateName(template.metadata.name)}
                          >
                            <TableCell className="font-medium">
                              <button
                                type="button"
                                aria-label={`Select template ${template.metadata.name}`}
                                aria-pressed={selectedTemplateName === template.metadata.name}
                                className="rounded-sm text-left outline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgb(var(--wb-color-accent-primary))]"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedTemplateName(template.metadata.name);
                                }}
                              >
                                {template.metadata.name}
                              </button>
                            </TableCell>
                            <TableCell className="text-[rgb(var(--wb-color-text-secondary))]">
                              {template.spec.entrypoint || "main"}
                            </TableCell>
                            <TableCell>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleTemplateRun(template.metadata.name);
                                }}
                              >
                                <Play size={13} fill="currentColor" />
                                Run
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              {canManageWorkflowTemplates ? (
                <PlatformInspectorFrame
                  tabs={[{ id: "edit", label: selectedTemplate ? "Edit template" : "New template", icon: <FolderCog size={14} /> }]}
                  activeTab="edit"
                  onTabChange={() => undefined}
                  onClose={() => {
                    setSelectedTemplateName(null);
                    applyTemplateDraft(createBlankTemplate(props.namespace));
                  }}
                  width="min(100%, 32rem)"
                >
                  <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
                    {templateActionError ? resourcePanelError(templateActionError) : null}
                    <div className="grid grid-cols-1 gap-3">
                      <label className="space-y-1">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgb(var(--wb-color-text-muted))]">
                          Name
                        </span>
                        <input
                          value={templateDraft.metadata.name}
                          onChange={(event) =>
                            applyTemplateDraft({
                              ...templateDraft,
                              metadata: { ...templateDraft.metadata, name: event.target.value },
                            })
                          }
                          className={textInputClass}
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgb(var(--wb-color-text-muted))]">
                          Entrypoint
                        </span>
                        <input
                          value={templateDraft.spec.entrypoint || "main"}
                          onChange={(event) =>
                            applyTemplateDraft({
                              ...templateDraft,
                              spec: { ...templateDraft.spec, entrypoint: event.target.value },
                            })
                          }
                          className={textInputClass}
                        />
                      </label>
                    </div>
                    <div className="min-h-[22rem] flex-1 overflow-hidden rounded-md border border-[rgb(var(--wb-color-border-subtle)/0.7)]">
                      <YamlDocumentEditor
                        title="Template YAML"
                        value={templateYaml}
                        path={yamlModelPaths.workflowTemplate}
                        documentId={`${props.namespace}/${selectedTemplateName || ":new-template"}`}
                        schemaLabel="Official Argo schema"
                        helpText="Autocomplete and validation use the official Argo Workflow JSON schema."
                        applyLabel="Apply to form"
                        applySuccessMessage="Template YAML was applied to the form fields."
                        downloadFileName={`${templateDraft.metadata.name || "workflow-template"}.yaml`}
                        onApply={handleTemplateYamlApply}
                        compact
                      />
                    </div>
                    <div className="flex flex-wrap gap-2 border-t border-[rgb(var(--wb-color-border-subtle)/0.56)] pt-3">
                      <Button type="button" size="sm" onClick={() => void handleTemplateSave()}>
                        <Save size={14} />
                        {selectedTemplate ? "Save" : "Create"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void handleTemplateRun(templateDraft.metadata.name)}
                        disabled={!templateDraft.metadata.name}
                      >
                        <Play size={14} fill="currentColor" />
                        Run
                      </Button>
                      {selectedTemplate ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="text-[rgb(var(--wb-color-status-error))]"
                          onClick={() =>
                            openConfirmation({
                              title: "Delete workflow template?",
                              message: `This removes ${selectedTemplate.metadata.name} from namespace ${props.namespace}.`,
                              confirmLabel: "Delete template",
                              tone: "danger",
                              onConfirm: async () => {
                                await platformResourceService.deleteWorkflowTemplate(
                                  props.namespace,
                                  selectedTemplate.metadata.name,
                                );
                                setSelectedTemplateName(null);
                                applyTemplateDraft(createBlankTemplate(props.namespace));
                                setConfirmationDialog(null);
                                await loadTemplates();
                              },
                            })
                          }
                        >
                          <Trash2 size={14} />
                          Delete
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </PlatformInspectorFrame>
              ) : (
                <div className="flex w-[22rem] shrink-0 items-center border-l border-[rgb(var(--wb-color-border-subtle)/0.65)] p-4">
                  <PlatformEmptyState
                    icon={<ShieldAlert size={28} />}
                    title="Template editing restricted"
                    body="The platform has disabled template authoring for the current role."
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <ConfirmationDialog
        open={Boolean(confirmationDialog)}
        title={confirmationDialog?.title || ""}
        message={confirmationDialog?.message || ""}
        confirmLabel={confirmationDialog?.confirmLabel}
        tone={confirmationDialog?.tone}
        onClose={() => setConfirmationDialog(null)}
        onConfirm={() => void confirmationDialog?.onConfirm()}
      />
    </>
  );
}
