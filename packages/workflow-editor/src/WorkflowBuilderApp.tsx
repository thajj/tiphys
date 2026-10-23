import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useUpdateNodeInternals,
  addEdge,
  reconnectEdge,
  Connection,
  ReactFlowProvider,
  Node,
  MarkerType,
  Edge,
  getOutgoers,
  Position,
  ConnectionLineType,
} from 'reactflow';

import Sidebar from './components/Sidebar';
import NodeConfigPanel from './components/NodeConfigPanel';
import { nodeTypes, edgeTypes } from './components/nodeTypes';
import { WorkflowEdgeDeleteContext } from './components/WorkflowEdge';
import AIAssistant from './components/AIAssistant';
import WorkflowSettings from './components/WorkflowSettings';
import YamlPreview from './components/YamlPreview';
import AnalysisModal from './components/AnalysisModal';
import WorkflowTabs from './components/WorkflowTabs';
import ImportModal from './components/ImportModal';
import { WorkflowLogsView } from './components/WorkflowLogsView';
import { WorkflowsSection } from './components/WorkflowsSection';
import { ProfileSection } from './components/ProfileSection';
import { ConfirmationDialog } from './components/ConfirmationDialog';

import type {
  PlatformNavigationSource,
  PlatformSectionRoute,
  WorkflowBuilderProps,
} from '@argocanvas/platform-sdk';
import {
  Button,
  cn,
  PlatformEmptyState,
  PlatformInspectorFrame,
  PlatformPreviewFrame,
  PlatformRail,
  PlatformSectionHeader,
  PlatformSegmentedTabs,
  PlatformStatusBadge,
  PlatformThemeToggle,
  PlatformTopbar,
  SectionNotice,
  Tooltip,
  usePlatformTheme,
} from '@argocanvas/ui-platform';
import { AppNode, WorkflowMetadata, WorkflowSpec, WorkflowSession, AppEdge, generateWorkflowObject, generateWorkflowTemplateObject, getLayoutedElements, parseYamlToWorkflow, validateGraphConnectivity, SimulationEngine } from '@argocanvas/workflow-domain';
import { argoService } from './services/argoService';
import { geminiService } from './services/geminiService';
import { platformResourceService } from './services/platformResourceService';
import { getWorkflowRuntime } from './platform/runtime';
import { draftMirrorStorage } from './platform/storage';
import {
  readBrowserNotificationPermission,
  readBrowserNotificationPreferences,
  requestBrowserNotificationPermission,
  saveBrowserNotificationPreferences,
  sendBrowserNotification,
} from './platform/notificationPreferences';
import { yamlModelPaths } from './yaml/monacoYaml';
import * as jsYaml from 'js-yaml';
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Columns,
  GitBranch,
  GitMerge,
  Layers,
  LayoutGrid,
  MoonStar,
  Network,
  PanelBottom,
  PanelRight,
  Play,
  RefreshCw,
  Settings,
  Sparkles,
  SunMedium,
  Terminal,
  Trash2,
  TriangleAlert,
  Undo,
  Redo,
  User,
  XCircle,
} from 'lucide-react';

// nodeTypes and edgeTypes are memoized inside the Flow component to avoid
// React Flow warning #002 during Vite HMR (hot module reload).

// Default Empty Workflow Template
const createNewSession = (index: number = 1, namespace: string = 'default'): WorkflowSession => ({
    id: `session-${Date.now()}-${Math.random()}`,
    name: `Workflow ${index}`,
    nodes: [],
    edges: [],
    metadata: { name: `new-workflow-${index}`, namespace },
    spec: { entrypoint: 'main', templates: [] },
    updatedAt: Date.now()
});

const getId = (prefix = 'node') => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

type BuilderRenderMode = 'embedded' | 'preview';
type WorkspaceView = 'pipeline' | 'logs';

type ExperiencePreferences = {
  preferredHomeSection: Extract<PlatformSectionRoute, 'pipelines' | 'workflows'>;
  preferredPipelineView: WorkspaceView;
};

const EXPERIENCE_PREFERENCES_KEY = 'wb-profile-experience-preferences';

const readExperiencePreferences = (): ExperiencePreferences => {
  if (typeof window === 'undefined') {
    return {
      preferredHomeSection: 'pipelines',
      preferredPipelineView: 'pipeline',
    };
  }

  try {
    const raw = window.localStorage.getItem(EXPERIENCE_PREFERENCES_KEY);
    if (!raw) {
      return {
        preferredHomeSection: 'pipelines',
        preferredPipelineView: 'pipeline',
      };
    }

    const parsed = JSON.parse(raw) as Partial<ExperiencePreferences>;
    const preferredHomeSection =
      parsed.preferredHomeSection === 'workflows'
        ? parsed.preferredHomeSection
        : 'pipelines';
    const preferredPipelineView =
      parsed.preferredPipelineView === 'logs'
        ? parsed.preferredPipelineView
        : 'pipeline';

    return { preferredHomeSection, preferredPipelineView };
  } catch {
    return {
      preferredHomeSection: 'pipelines',
      preferredPipelineView: 'pipeline',
    };
  }
};

const normalizePlatformSectionRoute = (
  route: PlatformSectionRoute | undefined,
  fallback: Extract<PlatformSectionRoute, 'pipelines' | 'workflows'>,
): PlatformSectionRoute => {
  if (route === 'team') {
    return 'profile';
  }

  // Dashboard was removed; keep the route type for host compat and land on home.
  if (route === 'dashboard') {
    return fallback;
  }

  return route ?? fallback;
};

const normalizeBasePath = (basePath: string) => {
  if (!basePath || basePath === '/') {
    return '/';
  }

  return basePath.endsWith('/') ? basePath : `${basePath}/`;
};

const getBrandAssetUrl = (basePath: string, assetName: string) =>
  `${normalizeBasePath(basePath)}brand/${assetName}`;

const Flow = ({ shell, renderMode }: { shell: WorkflowBuilderProps; renderMode: BuilderRenderMode }) => {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<number | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const { theme, setTheme, toggleTheme } = usePlatformTheme();
  const runtime = getWorkflowRuntime();
  const canUseAI = shell.featureFlags.aiAssistant && shell.permissions.canUseAI;
  const canSubmitWorkflow = shell.permissions.canSubmitWorkflow;
  const canManageWorkflowTemplates =
    shell.featureFlags.workflowTemplateManagement !== false &&
    shell.permissions.canManageWorkflowTemplates !== false;
  const isDarkTheme = theme === 'dark';
  const brandName = shell.branding?.displayName ?? 'ArgoCanvas';
  const customBrandMarkSrc = isDarkTheme
    ? shell.branding?.darkLogoUrl ?? shell.branding?.logoUrl
    : shell.branding?.logoUrl;
  const brandMarkSrc = customBrandMarkSrc ?? getBrandAssetUrl(
    shell.basePath,
    isDarkTheme ? 'argocanvas-mark-dark.svg' : 'argocanvas-mark-light.svg',
  );
  const nextThemeIcon = isDarkTheme ? <SunMedium size={16} /> : <MoonStar size={16} />;
  const previewThemeLabel = isDarkTheme ? 'Light mode' : 'Dark mode';
  const platformNotices = [
      !shell.permissions.canEditWorkflow ? {
          title: 'Read-only mode',
          body: 'You can inspect workflows. Saving changes and running workflows require editor access.',
          tone: 'warning' as const,
      } : null,
      !canSubmitWorkflow ? {
          title: 'Submission disabled',
          body: 'Workflow deployment is disabled by the platform for this role or environment. Dry-run and validation remain available.',
          tone: 'info' as const,
      } : null,
      !canUseAI ? {
          title: 'AI disabled',
          body: 'AI-assisted generation and analysis are routed through the platform gateway and are currently disabled for this role or environment.',
          tone: 'info' as const,
      } : null,
  ].filter(Boolean) as { title: string; body: string; tone: 'info' | 'warning' }[];
  const [experiencePreferences, setExperiencePreferences] = useState<ExperiencePreferences>(() =>
    readExperiencePreferences(),
  );
  const [notificationPreferences, setNotificationPreferences] = useState(() =>
    readBrowserNotificationPreferences(),
  );
  const [notificationPermission, setNotificationPermission] = useState(
    readBrowserNotificationPermission(),
  );



  // --- Global Session Management ---
  const [sessions, setSessions] = useState<WorkflowSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // --- Derived State for Active Session ---
  // We mirror the active session state into React Flow hooks for performance
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const updateNodeInternals = useUpdateNodeInternals();
  const [wfMetadata, setWfMetadata] = useState<WorkflowMetadata>({ name: '', namespace: '' });
  const [wfSpec, setWfSpec] = useState<WorkflowSpec>({ entrypoint: 'main', templates: [] });

  // --- React Flow Instance ---
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);
  const [selectedNode, setSelectedNode] = useState<AppNode | null>(null);
  const inspectedNode = nodes.find(node => node.id === selectedNode?.id) || null;

  // --- History Management (Per active session in memory only for simplicity) ---
  const [history, setHistory] = useState<{nodes: AppNode[], edges: Edge[]}[]>([]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // --- UI State ---
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [workflowStatus, setWorkflowStatus] = useState<string>('Ready');
  const [isRunInProgress, setIsRunInProgress] = useState(false);
  const [logs, setLogs] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState<'config' | 'yaml' | 'ai' | null>(null);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>(
    experiencePreferences.preferredPipelineView,
  );
  const [activePreviewSection, setActivePreviewSection] = useState<PlatformSectionRoute>(
    normalizePlatformSectionRoute(shell.activeSection, experiencePreferences.preferredHomeSection),
  );
  const [dagMode, setDagMode] = useState(true);
  const [layoutDirection, setLayoutDirection] = useState<'TB' | 'LR'>('LR');

  // --- Bottom Panel State ---
  const [bottomPanelTab, setBottomPanelTab] = useState<'logs' | 'validation'>('logs');
  const [bottomPanelOpen, setBottomPanelOpen] = useState(false);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(220);
  const bottomPanelToggleRef = useRef<HTMLButtonElement>(null);
  const dragStartY = useRef<number>(0);
  const dragStartHeight = useRef<number>(220);
  const isDraggingBottom = useRef<boolean>(false);

  // --- Right Inspector Overlay State ---
  const [renderedRightTab, setRenderedRightTab] = useState<'config' | 'yaml' | 'ai'>('config');
  const inspectorToggleRef = useRef<HTMLButtonElement>(null);
  const closeInspector = () => {
    setRightPanelTab(null);
    inspectorToggleRef.current?.focus();
  };

  useEffect(() => {
    if (rightPanelTab) {
      setRenderedRightTab(rightPanelTab);
    }
  }, [rightPanelTab]);

  const activeInspectorTab = rightPanelTab || renderedRightTab;
  const inspectorWidthStyle =
    activeInspectorTab === 'yaml'
      ? 'min(100%, clamp(22rem, 38vw, 36.25rem))'
      : 'min(100%, clamp(20rem, 32vw, 24rem))';

  // Analysis State
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Import State
  const [pendingImport, setPendingImport] = useState<{ nodes: AppNode[], edges: AppEdge[], metadata: WorkflowMetadata, spec: WorkflowSpec, fileName?: string } | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [confirmationDialog, setConfirmationDialog] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    tone?: 'danger' | 'warning' | 'info';
    onConfirm: () => void;
  } | null>(null);

  // --- Visibility Computation ---
  const getVisibleElements = useCallback(() => {
      const hiddenNodes = new Set<string>();

      // Find all collapsed nodes
      const collapsedNodes = nodes.filter(n => n.data.collapsed);

      // BFS to find all descendants of collapsed nodes
      collapsedNodes.forEach(collapsedNode => {
          const queue = [collapsedNode.id];
          while (queue.length > 0) {
              const currentId = queue.shift()!;
              edges.filter(e => e.source === currentId).forEach(e => {
                  if (!hiddenNodes.has(e.target)) {
                      hiddenNodes.add(e.target);
                      queue.push(e.target);
                  }
              });
          }
      });

      const isHorizontal = layoutDirection === 'LR';
      const visibleNodes = nodes.map(n => ({
          ...n,
          targetPosition: isHorizontal ? Position.Left : Position.Top,
          sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
          hidden: hiddenNodes.has(n.id)
      }));

      const visibleEdges = edges.map(e => ({
          ...e,
          hidden: hiddenNodes.has(e.source) || hiddenNodes.has(e.target)
      }));

      return { visibleNodes, visibleEdges };
  }, [nodes, edges, layoutDirection]);

  const { visibleNodes, visibleEdges } = getVisibleElements();

  // --- Persistence & Initialization ---
  useEffect(() => {
      let cancelled = false;

      const initialize = async () => {
          try {
              const savedDraft = await runtime.clients.drafts.loadDraft(shell.workspaceId, shell.projectId);
              const fallbackDraft = draftMirrorStorage.load();
              const parsedSessions = savedDraft ? savedDraft.sessions : fallbackDraft.sessions;
              const savedActiveId = savedDraft ? savedDraft.activeSessionId : fallbackDraft.activeSessionId;

              if (cancelled) return;

              if (parsedSessions.length > 0) {
                  setSessions(parsedSessions);
                  const initialId = savedActiveId && parsedSessions.find((s: any) => s.id === savedActiveId) ? savedActiveId : parsedSessions[0].id;
                  setActiveSessionId(initialId);
                  loadSessionToState(parsedSessions.find((s: any) => s.id === initialId)!);
              } else {
                  initDefault();
              }
          } catch (e) {
              console.error("Failed to load sessions", e);
              if (!cancelled) {
                  initDefault();
              }
          } finally {
              if (!cancelled) {
                  setIsInitialized(true);
              }
          }
      };

      initialize();

      return () => {
          cancelled = true;
          if (saveTimerRef.current) {
              window.clearTimeout(saveTimerRef.current);
          }
      };
  }, [runtime.clients.drafts, shell.projectId, shell.workspaceId, shell.namespaceScope]);

  const initDefault = () => {
      const def = createNewSession(1, shell.namespaceScope);
      const layouted = getLayoutedElements(def.nodes, def.edges, layoutDirection);
      def.nodes = layouted.nodes;
      def.edges = layouted.edges;
      // Start with an empty canvas
      setSessions([def]);
      setActiveSessionId(def.id);
      loadSessionToState(def);
  };

  const loadSessionToState = (session: WorkflowSession) => {
      setNodes(session.nodes);
      setEdges(session.edges);
      setWfMetadata(session.metadata);
      setWfSpec(session.spec);
      setHistory([{ nodes: session.nodes, edges: session.edges }]);
      setHistoryIndex(0);
      setSelectedNode(null);
  };

  useEffect(() => {
      if (!isInitialized || !activeSessionId || !shell.permissions.canEditWorkflow) return;

      const updatedSessions = sessions.map(s => {
          if (s.id === activeSessionId) {
              return {
                  ...s,
                  nodes,
                  edges,
                  metadata: wfMetadata,
                  spec: wfSpec,
                  updatedAt: Date.now(),
                  // Ensure name stays synced if changed elsewhere
                  name: s.name
              };
          }
          return s;
      });

      const draft = {
          sessions: updatedSessions,
          activeSessionId,
          savedAt: Date.now()
      };

      draftMirrorStorage.save(draft);
      shell.onDirtyStateChange?.(true);
      shell.eventBus.emit({
          type: 'workflow.dirty.changed',
          workspaceId: shell.workspaceId,
          projectId: shell.projectId,
          dirty: true
      });

      if (saveTimerRef.current) {
          window.clearTimeout(saveTimerRef.current);
      }

      let current = true;
      saveTimerRef.current = window.setTimeout(() => {
          // Keep writes in order, and skip queued snapshots superseded by newer edits.
          const persist = async () => {
              if (!current) return;
              try {
                  await runtime.clients.drafts.saveDraft(shell.workspaceId, shell.projectId, draft);
                  if (!current) return;
                  shell.onDirtyStateChange?.(false);
                  shell.eventBus.emit({
                      type: 'workflow.dirty.changed',
                      workspaceId: shell.workspaceId,
                      projectId: shell.projectId,
                      dirty: false
                  });
                  shell.eventBus.emit({
                      type: 'workflow.saved',
                      workspaceId: shell.workspaceId,
                      projectId: shell.projectId,
                      workflowName: wfMetadata.name
                  });
              } catch {
                  if (!current) return;
                  shell.telemetry.track('drafts.save_failed');
                  showError('Draft could not be saved to the server. Keep this tab open and retry when connected.');
              }
          };
          saveQueueRef.current = saveQueueRef.current.then(persist, persist);
      }, 600);

      return () => {
          current = false;
          if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      };

  }, [nodes, edges, wfMetadata, wfSpec, activeSessionId, sessions, isInitialized, runtime.clients.drafts, shell]);

  // Helper to sync current state back to sessions list before switching
  const syncCurrentSession = () => {
      const updatedSessions = sessions.map(s => {
          if (s.id === activeSessionId) {
              return { ...s, nodes, edges, metadata: wfMetadata, spec: wfSpec };
          }
          return s;
      });
      setSessions(updatedSessions);
      return updatedSessions;
  };

  // --- Actions ---

  const handleSwitchTab = (id: string) => {
      if (id === activeSessionId) return;
      syncCurrentSession(); // Save current work

      const target = sessions.find(s => s.id === id);
      if (target) {
          setActiveSessionId(id);
          loadSessionToState(target);
      }
  };

  const handleCloseTab = (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (sessions.length <= 1) return; // Prevent closing last tab

      setConfirmationDialog({
          title: 'Close workflow tab?',
          message: 'Unsaved work in this tab will be discarded from the current session view.',
          confirmLabel: 'Close tab',
          tone: 'warning',
          onConfirm: () => {
              const newSessions = sessions.filter(s => s.id !== id);
              setSessions(newSessions);

              if (id === activeSessionId) {
                  const index = sessions.findIndex(s => s.id === id);
                  const nextSession = sessions[index - 1] || sessions[index + 1];
                  setActiveSessionId(nextSession.id);
                  loadSessionToState(nextSession);
              }
              setConfirmationDialog(null);
          }
      });
  };

  const handleAddTab = () => {
      const updatedSessions = syncCurrentSession();
      const newSession = createNewSession(sessions.length + 1, shell.namespaceScope);
      const layouted = getLayoutedElements(newSession.nodes, newSession.edges, layoutDirection);
      newSession.nodes = layouted.nodes;
      newSession.edges = layouted.edges;
      setSessions([...updatedSessions, newSession]);
      setActiveSessionId(newSession.id);
      loadSessionToState(newSession);
  };

  const handleRenameSession = (id: string, newName: string) => {
      setSessions(prev => prev.map(s => {
          if (s.id === id) {
              // Update name and also metadata name to keep them in sync
              const updatedMetadata = { ...s.metadata, name: newName };
              // If it's the active session, update local state too
              if (id === activeSessionId) {
                  setWfMetadata(updatedMetadata);
              }
              return { ...s, name: newName, metadata: updatedMetadata, updatedAt: Date.now() };
          }
          return s;
      }));
  };

  const handleSettingsSave = (newMeta: WorkflowMetadata, newSpec: WorkflowSpec) => {
      setWfMetadata(newMeta);
      setWfSpec(newSpec);

      // Immediately update sessions list to reflect changes (especially name) in Tabs
      setSessions(prev => prev.map(s => {
          if (s.id === activeSessionId) {
              return {
                  ...s,
                  metadata: newMeta,
                  spec: newSpec,
                  name: newMeta.name || s.name, // Sync tab name with metadata name
                  updatedAt: Date.now()
              };
          }
          return s;
      }));
  };

  const handleDuplicate = () => {
      const updatedSessions = syncCurrentSession();
      const current = updatedSessions.find(s => s.id === activeSessionId)!;
      const dup: WorkflowSession = {
          ...JSON.parse(JSON.stringify(current)),
          id: `session-${Date.now()}`,
          name: `${current.name} (Copy)`,
          metadata: { ...current.metadata, name: `${current.metadata.name}-copy` }
      };
      setSessions([...updatedSessions, dup]);
      setActiveSessionId(dup.id);
      loadSessionToState(dup);
  };

  const handleDeleteWorkflow = () => {
      if (sessions.length <= 1) {
          setConfirmationDialog({
              title: 'Clear workflow?',
              message: 'This removes every node and edge from the active workflow and replaces it with a fresh draft.',
              confirmLabel: 'Clear workflow',
              tone: 'danger',
              onConfirm: () => {
                  const fresh = createNewSession(1, shell.namespaceScope);
                  setSessions([fresh]);
                  setActiveSessionId(fresh.id);
                  loadSessionToState(fresh);
                  setConfirmationDialog(null);
              }
          });
          return;
      }

      const id = activeSessionId!;
      setConfirmationDialog({
          title: 'Delete workflow?',
          message: 'This closes the active workflow tab. Unsaved work in this tab will be discarded.',
          confirmLabel: 'Delete',
          tone: 'danger',
          onConfirm: () => {
              const index = sessions.findIndex(s => s.id === id);
              const newSessions = sessions.filter(s => s.id !== id);
              const nextSession = sessions[index - 1] || sessions[index + 1];
              setSessions(newSessions);
              setActiveSessionId(nextSession.id);
              loadSessionToState(nextSession);
              setConfirmationDialog(null);
          }
      });
  };

  // --- Import Logic ---

  const processImport = (content: string, fileName?: string) => {
      const parsed = parseYamlToWorkflow(content);
      if (parsed) {
          setPendingImport({ ...parsed, fileName });
          setShowImportModal(true);
      } else {
          showError("Failed to parse Argo Workflow YAML.");
      }
  };

  const handleImportReplace = () => {
      if (pendingImport) {
          const layouted = getLayoutedElements(pendingImport.nodes, pendingImport.edges, layoutDirection);
          setNodes(layouted.nodes);
          setEdges(layouted.edges);
          setWfMetadata(pendingImport.metadata);
          setWfSpec(pendingImport.spec);

          // Also update the session name
          setSessions(prev => prev.map(s => {
              if (s.id === activeSessionId) {
                  return { ...s, name: pendingImport.metadata.name };
              }
              return s;
          }));

          pushHistory(layouted.nodes, layouted.edges);

          setTimeout(() => {
              updateNodeInternals(layouted.nodes.map(n => n.id));
              reactFlowInstance?.fitView({ padding: 0.25, duration: 400 });
          }, 30);
      }
      setPendingImport(null);
      setShowImportModal(false);
  };

  const handleImportNewTab = () => {
      if (pendingImport) {
          const updatedSessions = syncCurrentSession();
          const layouted = getLayoutedElements(pendingImport.nodes, pendingImport.edges, layoutDirection);
          const newSession: WorkflowSession = {
              id: `session-${Date.now()}`,
              name: pendingImport.metadata.name,
              nodes: layouted.nodes,
              edges: layouted.edges,
              metadata: pendingImport.metadata,
              spec: pendingImport.spec,
              updatedAt: Date.now()
          };
          setSessions([...updatedSessions, newSession]);
          setActiveSessionId(newSession.id);
          loadSessionToState(newSession);

          setTimeout(() => {
              updateNodeInternals(layouted.nodes.map(n => n.id));
              reactFlowInstance?.fitView({ padding: 0.25, duration: 400 });
          }, 30);
      }
      setPendingImport(null);
      setShowImportModal(false);
  };

  // Callback to handle updates from YAML Editor
  const handleYamlUpdate = (parsed: { nodes: AppNode[], edges: AppEdge[], metadata: WorkflowMetadata, spec: WorkflowSpec }) => {
     const layouted = getLayoutedElements(parsed.nodes, parsed.edges, layoutDirection);
     setNodes(layouted.nodes);
     setEdges(layouted.edges);
     setWfMetadata(parsed.metadata);
     setWfSpec(parsed.spec);

     // Update session metadata too
     setSessions(prev => prev.map(s => {
        if (s.id === activeSessionId) {
            return { ...s, name: parsed.metadata.name, metadata: parsed.metadata, spec: parsed.spec };
        }
        return s;
     }));

     pushHistory(layouted.nodes, layouted.edges);

     // Optional: Fit view after big change
     setTimeout(() => reactFlowInstance?.fitView({ duration: 800 }), 100);
  };

  // --- Global Event Listeners (Drop & Paste) ---
  useEffect(() => {
      const handlePaste = (e: ClipboardEvent) => {
          const text = e.clipboardData?.getData('text');
          if (text && (text.includes('apiVersion: argoproj.io') || text.includes('kind: Workflow'))) {
              e.preventDefault();
              processImport(text, 'pasted-workflow.yaml');
          }
      };

      const handleDragOver = (e: DragEvent) => {
          e.preventDefault();
      };

      const handleDrop = (e: DragEvent) => {
          // Check if file drop
          if (e.dataTransfer && e.dataTransfer.files.length > 0) {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              const reader = new FileReader();
              reader.onload = (ev) => {
                  const content = ev.target?.result as string;
                  processImport(content, file.name);
              };
              reader.readAsText(file);
          }
      };

      window.addEventListener('paste', handlePaste);
      window.addEventListener('dragover', handleDragOver);
      window.addEventListener('drop', handleDrop);

      return () => {
          window.removeEventListener('paste', handlePaste);
          window.removeEventListener('dragover', handleDragOver);
          window.removeEventListener('drop', handleDrop);
      };
  }, [sessions, activeSessionId]); // Re-bind if necessary

  // --- History Management ---
  const pushHistory = useCallback((newNodes: AppNode[], newEdges: Edge[]) => {
      const current = { nodes: newNodes, edges: newEdges };
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(current);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
  }, [history, historyIndex]);

  const undo = () => {
      if (historyIndex > 0) {
          const prev = history[historyIndex - 1];
          setNodes(prev.nodes);
          setEdges(prev.edges);
          setHistoryIndex(historyIndex - 1);
      }
  };

  const redo = () => {
      if (historyIndex < history.length - 1) {
          const next = history[historyIndex + 1];
          setNodes(next.nodes);
          setEdges(next.edges);
          setHistoryIndex(historyIndex + 1);
      }
  };

  const deleteEdge = useCallback((id: string) => {
      if (!shell.permissions.canEditWorkflow) return;
      const nextEdges = edges.filter(edge => edge.id !== id);
      if (nextEdges.length === edges.length) return;
      setEdges(nextEdges);
      pushHistory(nodes, nextEdges);
  }, [shell.permissions.canEditWorkflow, edges, nodes, setEdges, pushHistory]);

  const showError = (msg: string) => {
      setErrorMsg(msg);
      setTimeout(() => setErrorMsg(null), 4000);
  };

  // --- Graph Logic & Visualization ---

  const resetNodeStyles = () => {
    setNodes(nds => nds.map(n => ({ ...n, style: { ...n.style, opacity: 1 } })));
    setEdges(eds => eds.map(e => ({
        ...e,
        style: { ...e.style, stroke: e.type === 'data' ? '#2563eb' : '#9c9ca3', strokeWidth: e.type === 'data' ? 2 : 1.5 },
        animated: true
    })));
  };

  const highlightDependencies = (nodeId: string) => {
      if (!dagMode) return;
      const ancestors = new Set<string>();
      const descendants = new Set<string>();
      const findAncestors = (currId: string) => {
          edges.forEach(e => {
              if (e.target === currId && !ancestors.has(e.source)) {
                  ancestors.add(e.source);
                  findAncestors(e.source);
              }
          });
      };
      const findDescendants = (currId: string) => {
          edges.forEach(e => {
              if (e.source === currId && !descendants.has(e.target)) {
                  descendants.add(e.target);
                  findDescendants(e.target);
              }
          });
      };
      findAncestors(nodeId);
      findDescendants(nodeId);
      const relevantNodeIds = new Set([...ancestors, ...descendants, nodeId]);
      setNodes(nds => nds.map(n => ({
          ...n,
          style: {
              ...n.style,
              opacity: relevantNodeIds.has(n.id) ? 1 : 0.2,
              transition: 'opacity 0.3s ease'
          }
      })));
      setEdges(eds => eds.map(e => {
          const isAncestorEdge = ancestors.has(e.source) && (ancestors.has(e.target) || e.target === nodeId);
          const isDescendantEdge = (descendants.has(e.source) || e.source === nodeId) && descendants.has(e.target);
          if (isAncestorEdge) return { ...e, style: { stroke: '#f59e0b', strokeWidth: 3 }, animated: true, zIndex: 10 };
          if (isDescendantEdge) return { ...e, style: { stroke: '#2563eb', strokeWidth: 3 }, animated: true, zIndex: 10 };
          return { ...e, style: { stroke: '#e2e8f0', strokeWidth: 1, opacity: 0.2 }, animated: false, zIndex: 0 };
      }));
  };

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setRightPanelTab(prev => prev === 'config' ? null : prev);
    resetNodeStyles();
  }, []);

  const isValidConnection = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return false;
    const isAlreadyConnected = edges.some(
      (e) => e.source === connection.source && e.target === connection.target
    );
    if (isAlreadyConnected) return false;

    const sourceNode = nodes.find((n) => n.id === connection.source);
    const targetNode = nodes.find((n) => n.id === connection.target);
    if (!sourceNode || !targetNode) return false;

    const hasCycle = (node: Node, visited = new Set<string>()): boolean => {
      if (visited.has(node.id)) return false;
      visited.add(node.id);
      if (node.id === connection.source) return true;
      const outgoers = getOutgoers(node, nodes, edges);
      return outgoers.some((outgoer) => hasCycle(outgoer, new Set(visited)));
    };

    return !hasCycle(targetNode);
  }, [nodes, edges]);

  const onConnect = useCallback((params: Connection) => {
      if (params.source === params.target) { showError("Invalid Connection: Cannot connect a node to itself."); return; }
      const sourceNodeCheck = nodes.find((n) => n.id === params.source);
      const targetNodeCheck = nodes.find((n) => n.id === params.target);
      if (sourceNodeCheck && targetNodeCheck) {
          const hasCycle = (node: Node, visited = new Set<string>()) => {
             if (visited.has(node.id)) return false;
             visited.add(node.id);
             if (node.id === sourceNodeCheck.id) return true;
             const outgoers = getOutgoers(node, nodes, edges);
             return outgoers.some((outgoer) => hasCycle(outgoer, new Set(visited)));
          };
          if (hasCycle(targetNodeCheck)) { showError("Invalid Connection: This would create a cycle/infinite loop."); return; }
      }
      setEdges((eds) => {
        const next = addEdge({
          ...params,
          type: 'smoothstep',
          animated: true,
          markerEnd: { type: MarkerType.ArrowClosed },
        }, eds);
        pushHistory(nodes, next);
        return next;
      });
  }, [setEdges, nodes, edges, pushHistory, showError]);

  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      setEdges((els) => {
        const next = reconnectEdge(oldEdge, newConnection, els);
        pushHistory(nodes, next);
        return next;
      });
    },
    [setEdges, pushHistory, nodes]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      // Only handle sidebar drops here. Global file drops are handled by window listener
      if (!reactFlowWrapper.current || !reactFlowInstance) return;

      // If we are dragging files, ignore here (handled globally)
      if (event.dataTransfer.files.length > 0) return;

      const type = event.dataTransfer.getData('application/reactflow');
      const payloadStr = event.dataTransfer.getData('application/payload');
      if (!type || !payloadStr) return;

      const payload = JSON.parse(payloadStr);
      const position = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });

      // Handle Remote WorkflowTemplate Drop
      if (type === 'workflow-template') {
          try {
              const yamlStr = jsYaml.dump(payload.rawTemplate);
              const parsed = parseYamlToWorkflow(yamlStr);
              if (parsed && parsed.nodes.length > 0) {
                  const rawNodes = parsed.nodes.map((n: any) => ({
                      ...n,
                      id: getId(),
                      data: { ...n.data, status: 'Pending' },
                      targetPosition: layoutDirection === 'LR' ? Position.Left : Position.Top,
                      sourcePosition: layoutDirection === 'LR' ? Position.Right : Position.Bottom,
                  }));
                  const idMap: Record<string, string> = {};
                  parsed.nodes.forEach((oldN: any, idx: number) => { idMap[oldN.id] = rawNodes[idx].id; });
                  const rawEdges = parsed.edges.map((e: any) => ({
                      ...e,
                      id: `e${idMap[e.source]}-${idMap[e.target]}`,
                      source: idMap[e.source],
                      target: idMap[e.target],
                      type: 'smoothstep',
                      animated: true,
                      markerEnd: { type: MarkerType.ArrowClosed }
                  }));

                  const layouted = getLayoutedElements(rawNodes, rawEdges, layoutDirection);
                  const minX = Math.min(...layouted.nodes.map(n => n.position.x));
                  const minY = Math.min(...layouted.nodes.map(n => n.position.y));
                  const newNodes = layouted.nodes.map(n => ({
                      ...n,
                      position: {
                          x: position.x + (n.position.x - minX),
                          y: position.y + (n.position.y - minY),
                      }
                  }));

                  if (nodes.length > 0) {
                      // Use Import Modal UX to ask Replace vs New Tab
                      setPendingImport({
                          ...parsed,
                          nodes: newNodes,
                          edges: layouted.edges,
                          fileName: payload.name || 'Remote Template'
                      });
                      setShowImportModal(true);
                      return;
                  }

                  // Empty canvas, just add
                  setNodes(nds => {
                      const res = nds.concat(newNodes);
                      pushHistory(res, edges.concat(layouted.edges));
                      return res;
                  });
                  setEdges(eds => eds.concat(layouted.edges));
                  setTimeout(() => {
                      updateNodeInternals(newNodes.map(n => n.id));
                  }, 30);
              } else {
                  showError(`Failed to expand template "${payload.name}". No nodes generated.`);
              }
          } catch (e: any) {
              showError(`Could not expand template: ${e.message}`);
          }
          return;
      }

      // Handle Pattern Drop with Replacement Logic
      if (type === 'pattern') {
          const rawNodes = payload.nodes.map((n: any) => ({
              ...n,
              id: getId(),
              data: { ...n.data, status: 'Pending' },
              targetPosition: layoutDirection === 'LR' ? Position.Left : Position.Top,
              sourcePosition: layoutDirection === 'LR' ? Position.Right : Position.Bottom,
          }));
          const idMap: Record<string, string> = {};
          payload.nodes.forEach((oldN: any, idx: number) => { idMap[oldN.id] = rawNodes[idx].id; });
          const newEdges = payload.edges.map((e: any) => ({
              ...e,
              id: `e${idMap[e.source]}-${idMap[e.target]}`,
              source: idMap[e.source],
              target: idMap[e.target],
              type: 'smoothstep',
              animated: true,
              markerEnd: { type: MarkerType.ArrowClosed }
          }));

          const layouted = getLayoutedElements(rawNodes, newEdges, layoutDirection);
          const minX = Math.min(...layouted.nodes.map(n => n.position.x));
          const minY = Math.min(...layouted.nodes.map(n => n.position.y));
          const positionedNodes = layouted.nodes.map(n => ({
              ...n,
              position: {
                  x: position.x + (n.position.x - minX),
                  y: position.y + (n.position.y - minY),
              }
          }));

          // Check if workflow is already populated
          if (nodes.length > 0) {
              setPendingImport({
                  nodes: positionedNodes,
                  edges: layouted.edges,
                  metadata: { name: payload.name || 'Pattern Workflow', namespace: 'default' },
                  spec: { entrypoint: 'main', templates: [] },
                  fileName: payload.name || 'Selected Pattern'
              });
              setShowImportModal(true);
              return;
          }

          // Empty canvas, just add
          setNodes((nds) => { const res = nds.concat(positionedNodes); pushHistory(res, edges.concat(layouted.edges)); return res; });
          setEdges((eds) => eds.concat(layouted.edges));
          setTimeout(() => {
              updateNodeInternals(positionedNodes.map(n => n.id));
          }, 30);
          return;
      }

      // Handle Single Node Drop
      const newNode: AppNode = {
          id: getId(),
          type,
          position,
          data: { ...payload, status: 'Pending' },
          targetPosition: layoutDirection === 'LR' ? Position.Left : Position.Top,
          sourcePosition: layoutDirection === 'LR' ? Position.Right : Position.Bottom,
      };

      setNodes((nds) => {
          const res = nds.concat(newNode);
          pushHistory(res, edges);
          return res;
      });
      setSelectedNode(newNode);
      setRightPanelTab('config');
    },
    [reactFlowInstance, setNodes, pushHistory, edges, layoutDirection, showError]
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node as AppNode);
    setRightPanelTab('config');
    if (dagMode) highlightDependencies(node.id);
  }, [dagMode, edges]);

  const onNodeUpdate = (id: string, newData: any) => {
    setNodes((nds) => {
      const updatedNodes = nds.map((node) => {
        if (node.id === id) {
          const updated = { ...node, data: newData };
          if (selectedNode?.id === id) setSelectedNode(updated);
          return updated;
        }
        return node;
      });
      return updatedNodes;
    });
  };

  const onNodeDelete = (id: string) => {
      setNodes((nds) => {
          const res = nds.filter((n) => n.id !== id);
          pushHistory(res, edges);
          return res;
      });
      setSelectedNode(null);
      resetNodeStyles();
  };

  // Replaces the old single-node AI generation with full workflow generation
  const handleAiWorkflowGeneration = (yamlContent: string) => {
      // Use existing import logic to give user choice (Replace vs New Tab)
      processImport(yamlContent, 'AI Generated Workflow');
  };

  const handleRunWorkflow = async (isDryRun: boolean = false) => {
      if (isRunInProgress) return;
      if (!isDryRun && !canSubmitWorkflow) {
          showError('Workflow submission is disabled by the platform.');
          return;
      }

      // 1. Validation Pre-flight check
      const graphErrors = validateGraphConnectivity(nodes, edges);
      if (graphErrors.length > 0) {
          showError(graphErrors[0]);
          return;
      }

      setIsRunInProgress(true);
      setWorkflowStatus(isDryRun ? 'Dry Run...' : 'Submitting...');
      setLogs(isDryRun ? '--- DRY RUN MODE ---\nInitializing simulation engine...' : '--- ARGO SUBMISSION ---\nSubmitting workflow to Argo...');
      setBottomPanelOpen(true);
      setBottomPanelTab('logs');

      // Reset all nodes to Pending
      setNodes(nds => nds.map(n => ({ ...n, data: { ...n.data, status: 'Pending' } })));

      try {
          if (!isDryRun) {
              const workflowPayload = generateWorkflowObject(nodes, edges, wfMetadata, wfSpec);
              const result = await argoService.submitWorkflow(wfMetadata.namespace, workflowPayload);
              setWorkflowStatus('Submitted');
              setLogs(prev => prev + `\n[SUBMITTED] ${wfMetadata.namespace}/${result.metadata.name}\nOpen Workflows to follow the actual execution status and logs.`);
              shell.eventBus.emit({
                  type: 'workflow.submitted',
                  workspaceId: shell.workspaceId,
                  projectId: shell.projectId,
                  namespace: wfMetadata.namespace,
                  workflowName: result.metadata.name
              });
              shell.telemetry.track('workflow.submitted', {
                  namespace: wfMetadata.namespace,
                  workflowName: result.metadata.name
              });
              return;
          }

          const engine = new SimulationEngine(nodes, edges);
          const plan = engine.getExecutionPlan();

          setLogs(prev => prev + `\n[PLAN] Execution plan generated with ${plan.length} levels.`);

          for (let i = 0; i < plan.length; i++) {
              const level = plan[i];
              setLogs(prev => prev + `\n[LEVEL ${i+1}] Starting parallel execution of ${level.length} steps...`);

              // Set level nodes to Running
              setNodes(nds => nds.map(n =>
                  level.includes(n.id) ? { ...n, data: { ...n.data, status: 'Running' } } : n
              ));

              // Simulate nodes in this level in parallel
              const results = await Promise.all(level.map(nodeId => {
                  const node = nodes.find(n => n.id === nodeId)!;
                  return SimulationEngine.simulateNode(node);
              }));

              // Update logs and set nodes to Succeeded
              results.forEach((res, idx) => {
                  setLogs(prev => prev + `\n${res.logs.join('\n')}`);
              });

              setNodes(nds => nds.map(n =>
                  level.includes(n.id) ? { ...n, data: { ...n.data, status: 'Succeeded' } } : n
              ));
          }

          setWorkflowStatus('Dry Run Succeeded');
          setLogs(prev => prev + `\n[FINISH] Workflow simulation completed successfully.`);

      } catch (err) {
          console.error(err);
          setWorkflowStatus('Failed');
          const message = err instanceof Error ? err.message : (isDryRun ? 'Simulation failed.' : 'Workflow submission failed.');
          setLogs(prev => prev + `\n[ERROR] ${message}`);
      } finally {
          setIsRunInProgress(false);
      }
  };

  const buildCurrentWorkflowTemplate = () =>
    generateWorkflowTemplateObject(nodes, edges, wfMetadata, wfSpec);

  const handlePublishWorkflowTemplate = async () => {
    if (!canManageWorkflowTemplates) {
      showError('Workflow template management is disabled by the platform.');
      return;
    }

    const graphErrors = validateGraphConnectivity(nodes, edges);
    if (graphErrors.length > 0) {
      showError(graphErrors[0]);
      return;
    }

    try {
      const template = buildCurrentWorkflowTemplate();
      await platformResourceService.createWorkflowTemplate(
        wfMetadata.namespace,
        template,
      );
      showError(`Workflow template "${template.metadata.name}" published.`);
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to publish workflow template.');
    }
  };

  const handleUpdateWorkflowTemplate = async () => {
    if (!canManageWorkflowTemplates) {
      showError('Workflow template management is disabled by the platform.');
      return;
    }

    try {
      const template = buildCurrentWorkflowTemplate();
      const currentTemplate = await platformResourceService.getWorkflowTemplate(
        wfMetadata.namespace,
        template.metadata.name,
      );
      if (!currentTemplate) throw new Error('Publish this template before updating it.');
      template.metadata.resourceVersion = currentTemplate.metadata.resourceVersion;
      await platformResourceService.updateWorkflowTemplate(
        wfMetadata.namespace,
        template.metadata.name,
        template,
      );
      showError(`Workflow template "${template.metadata.name}" updated.`);
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to update workflow template.');
    }
  };

  const handleRequestBrowserNotifications = async () => {
    const nextPermission = await requestBrowserNotificationPermission();
    setNotificationPermission(nextPermission);
  };

  const handleSendTestBrowserNotification = () => {
    const sent = sendBrowserNotification(notificationPreferences, 'workflowSucceeded', {
      title: 'ArgoCanvas Test Notification',
      body: 'Browser notifications are configured for this profile.',
      tag: 'workflow-builder:test-notification',
    });
    if (!sent) {
      showError('Browser notifications are muted or permission is not granted.');
    }
  };

  const handleAnalyze = async () => {
    if (!canUseAI) {
        showError("AI analysis is disabled by the platform.");
        return;
    }
    setShowAnalysis(true);
    setIsAnalyzing(true);
    setAnalysisResult(null);
    try {
        const suggestion = await geminiService.analyzeWorkflow(nodes, edges);
        setAnalysisResult(suggestion);
    } catch (e) {
        setAnalysisResult("Failed to generate analysis through the platform AI gateway. Please try again later.");
    } finally {
        setIsAnalyzing(false);
    }
  };

  // Drag-to-resize bottom panel
  const handleBottomDragStart = (e: React.MouseEvent) => {
    isDraggingBottom.current = true;
    dragStartY.current = e.clientY;
    dragStartHeight.current = bottomPanelHeight;
    const onMove = (me: MouseEvent) => {
      const delta = dragStartY.current - me.clientY;
      setBottomPanelHeight(Math.max(120, Math.min(500, dragStartHeight.current + delta)));
    };
    const onUp = () => {
      isDraggingBottom.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  useEffect(() => {
    if (workspaceView === 'logs' && !shell.permissions.canViewLogs) {
      setWorkspaceView('pipeline');
    }
  }, [shell.permissions.canViewLogs, workspaceView]);

  const graphValidationErrors = validateGraphConnectivity(nodes, edges);
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );
  const workflowTitle = wfMetadata.name || activeSession?.name || 'Untitled Workflow';
  const workflowStatusTone =
    workflowStatus === 'Succeeded' || workflowStatus === 'Dry Run Succeeded'
      ? 'success'
      : workflowStatus === 'Failed'
        ? 'danger'
        : workflowStatus === 'Submitted' || workflowStatus.includes('Dry Run') || workflowStatus.includes('...')
        ? 'info'
          : 'default';
  const handlePlatformNavigation = useCallback(
    (to: PlatformSectionRoute, source: PlatformNavigationSource) => {
      const normalizedTo = normalizePlatformSectionRoute(
        to,
        experiencePreferences.preferredHomeSection,
      );

      if (
        renderMode === 'preview' &&
        (normalizedTo === 'pipelines' ||
          normalizedTo === 'workflows' ||
          normalizedTo === 'profile')
      ) {
        setActivePreviewSection(normalizedTo);
      }

      shell.eventBus.emit({ type: 'navigation.requested', to: normalizedTo, source });
    },
    [experiencePreferences.preferredHomeSection, renderMode, shell.eventBus],
  );

  const activeSection =
    renderMode === 'preview'
      ? activePreviewSection
      : normalizePlatformSectionRoute(shell.activeSection, experiencePreferences.preferredHomeSection);

  useEffect(() => {
    const canvas = reactFlowWrapper.current;
    if (!canvas || !reactFlowInstance) return;

    let timer: number | undefined;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        // Keep the whole graph visible when an inspector or log panel takes canvas space.
        void reactFlowInstance.fitView({ padding: 0.3, duration: 200 });
      }, 100);
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [reactFlowInstance, activeSection, workspaceView]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(
        EXPERIENCE_PREFERENCES_KEY,
        JSON.stringify(experiencePreferences),
      );
    } catch { /* Preferences remain usable in memory when browser storage is blocked. */ }
  }, [experiencePreferences]);

  useEffect(() => {
    try {
      saveBrowserNotificationPreferences(notificationPreferences);
    } catch { /* A preference write must not prevent the editor from starting. */ }
  }, [notificationPreferences]);

  useEffect(() => {
    setWorkspaceView(experiencePreferences.preferredPipelineView);
  }, [experiencePreferences.preferredPipelineView]);

  const canvasToolBtnClass =
    'flex h-8 w-8 items-center justify-center rounded-md text-[rgb(var(--wb-color-text-secondary))] transition-colors hover:bg-[rgb(var(--wb-color-bg-surface-hover))] hover:text-[rgb(var(--wb-color-text-primary))] disabled:opacity-40';

  const profileSectionActions =
    renderMode === 'embedded' ? (
      <div className="flex items-center">
        <PlatformThemeToggle />
      </div>
    ) : null;

  const editorTabs = [
    {
      id: 'pipeline',
      label: 'Editor',
      active: workspaceView === 'pipeline',
      onClick: () => setWorkspaceView('pipeline'),
    },
    {
      id: 'logs',
      label: 'Executions',
      active: workspaceView === 'logs',
      disabled: !shell.permissions.canViewLogs,
      onClick: () => shell.permissions.canViewLogs && setWorkspaceView('logs'),
    },
  ];

  const pipelineTopbar = (
    <PlatformTopbar
      breadcrumbs={
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[rgb(var(--wb-color-text-secondary))]">
              {wfMetadata.namespace || shell.namespaceScope}
            </span>
            <span className="text-[rgb(var(--wb-color-text-muted))]">/</span>
            <h1 className="truncate text-sm font-semibold text-[rgb(var(--wb-color-text-primary))]">
              {workflowTitle}
            </h1>
          </div>
          <PlatformStatusBadge
            tone={workflowStatusTone as 'default' | 'success' | 'danger' | 'info'}
            pulse={
              workflowStatus.includes('...') ||
              workflowStatus.includes('Simulating') ||
              workflowStatus.includes('Dry Run')
            }
          >
            {workflowStatus}
          </PlatformStatusBadge>
        </div>
      }
      center={<PlatformSegmentedTabs tabs={editorTabs} />}
      actions={
        <div className="flex items-center gap-1.5">
          {renderMode === 'embedded' ? <PlatformThemeToggle compact /> : null}
          <Tooltip label="Undo" side="bottom">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Undo"
              onClick={undo}
              disabled={historyIndex === 0}
            >
              <Undo size={15} />
            </Button>
          </Tooltip>
          <Tooltip label="Redo" side="bottom">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Redo"
              onClick={redo}
              disabled={historyIndex === history.length - 1}
            >
              <Redo size={15} />
            </Button>
          </Tooltip>
          <Tooltip label="Workflow settings" side="bottom">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Workflow settings"
              onClick={() => setIsSettingsOpen(true)}
            >
              <Settings size={15} />
            </Button>
          </Tooltip>
          <Tooltip label="Delete workflow" side="bottom">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete workflow"
              onClick={handleDeleteWorkflow}
              className="text-[rgb(var(--wb-color-status-error))] hover:bg-[rgb(var(--wb-color-status-error)/0.12)] hover:text-[rgb(var(--wb-color-status-error))]"
            >
              <Trash2 size={15} />
            </Button>
          </Tooltip>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label="Update template"
            onClick={handleUpdateWorkflowTemplate}
            disabled={!canManageWorkflowTemplates}
            className="hidden h-8 sm:inline-flex"
          >
            <RefreshCw size={13} />
            Update
          </Button>
          <Button
            type="button"
            size="sm"
            aria-label="Publish template"
            onClick={handlePublishWorkflowTemplate}
            disabled={!canManageWorkflowTemplates}
            className="h-8 gap-1.5"
          >
            <Layers size={13} />
            Publish
          </Button>
        </div>
      }
    />
  );

  const inspectorTabs = [
    { id: 'config', label: 'Settings', icon: <Settings size={12} /> },
    { id: 'yaml', label: 'YAML', icon: <Columns size={12} /> },
    { id: 'ai', label: 'AI Ask', icon: <Sparkles size={12} />, hidden: !canUseAI },
  ];

  const flowControlChromeClass =
    '!m-3 !rounded-md !border !border-[rgb(var(--wb-color-border-subtle))] !bg-[rgb(var(--wb-color-bg-surface))] !text-[rgb(var(--wb-color-text-secondary))] !shadow-[0_2px_8px_rgba(0,0,0,0.08)]';
  const miniMapChromeClass =
    '!m-3 !rounded-md !border !border-[rgb(var(--wb-color-border-subtle))] !bg-[rgb(var(--wb-color-bg-surface))] !shadow-[0_2px_8px_rgba(0,0,0,0.08)]';

  const body = (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[rgb(var(--wb-color-bg-base))] font-sans">
      {activeSection === 'profile' ? (
        <PlatformSectionHeader
          icon={<User size={16} />}
          title="Profile"
          meta={
            <>
              <PlatformStatusBadge tone="info">Local preferences</PlatformStatusBadge>
              <span className="truncate">{shell.namespaceScope}</span>
            </>
          }
          actions={profileSectionActions}
        />
      ) : (
        pipelineTopbar
      )}

      {activeSection === 'pipelines' ? (
        <div className="border-b border-[rgb(var(--wb-color-border-subtle))] bg-[rgb(var(--wb-color-bg-surface))]">
          <WorkflowTabs
            sessions={sessions}
            activeSessionId={activeSessionId || ''}
            onSwitch={handleSwitchTab}
            onClose={handleCloseTab}
            onAdd={handleAddTab}
            onDuplicate={handleDuplicate}
            onRename={handleRenameSession}
          />
        </div>
      ) : null}

      {platformNotices.length > 0 && (
        <div className="border-b border-[rgb(var(--wb-color-border-subtle))] bg-[rgb(var(--wb-color-bg-surface))] px-4 py-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {platformNotices.map((notice) => (
              <div key={notice.title}>
                <SectionNotice title={notice.title} body={notice.body} tone={notice.tone} />
              </div>
            ))}
          </div>
        </div>
      )}

      {activeSection === 'profile' ? (
        <ProfileSection
          workspaceId={shell.workspaceId}
          projectId={shell.projectId}
          namespaceScope={shell.namespaceScope}
          workflowName={wfMetadata.name || workflowTitle}
          workflowNamespace={wfMetadata.namespace || shell.namespaceScope}
          workflowStatus={workflowStatus}
          entrypoint={wfSpec.entrypoint || 'main'}
          sessionCount={sessions.length}
          activeSessionName={activeSession?.name}
          teamLabel={wfMetadata.labels?.team}
          currentTheme={theme}
          preferredHomeSection={experiencePreferences.preferredHomeSection}
          preferredPipelineView={experiencePreferences.preferredPipelineView}
          featureFlags={shell.featureFlags}
          permissions={shell.permissions}
          notificationPreferences={notificationPreferences}
          notificationPermission={notificationPermission}
          onThemeChange={setTheme}
          onPreferredHomeSectionChange={(preferredHomeSection) =>
            setExperiencePreferences((current) => ({ ...current, preferredHomeSection }))
          }
          onPreferredPipelineViewChange={(preferredPipelineView) =>
            setExperiencePreferences((current) => ({ ...current, preferredPipelineView }))
          }
          onNotificationPreferencesChange={setNotificationPreferences}
          onRequestNotificationPermission={handleRequestBrowserNotifications}
          onSendTestNotification={handleSendTestBrowserNotification}
        />
      ) : workspaceView === 'pipeline' ? (
      <div className="relative flex min-h-0 flex-1 overflow-hidden">

          <Sidebar />

          {/* Canvas (Full-width, full-height, rock solid) */}
          <div className="wb-grid-surface absolute inset-0 min-h-0 min-w-0" ref={reactFlowWrapper}>
              <WorkflowEdgeDeleteContext.Provider value={shell.permissions.canEditWorkflow ? deleteEdge : null}>
              <ReactFlow
                  nodes={visibleNodes}
                  edges={visibleEdges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  nodesDraggable={shell.permissions.canEditWorkflow}
                  nodesConnectable={shell.permissions.canEditWorkflow}
                  deleteKeyCode={shell.permissions.canEditWorkflow ? ['Backspace', 'Delete'] : null}
                  onConnect={onConnect}
                  onReconnect={onReconnect}
                  edgesUpdatable={shell.permissions.canEditWorkflow}
                  edgesFocusable={true}
                  isValidConnection={isValidConnection}
                  connectionLineType={ConnectionLineType.SmoothStep}
                  connectionLineStyle={{ stroke: 'rgb(var(--wb-color-accent-primary))', strokeWidth: 2 }}
                  connectionRadius={22}
                  defaultEdgeOptions={{
                    type: 'smoothstep',
                    animated: true,
                    markerEnd: { type: MarkerType.ArrowClosed },
                  }}
                  onInit={setReactFlowInstance}
                  onDrop={onDrop}
                  onDragOver={onDragOver}
                  onNodeClick={onNodeClick}
                  onPaneClick={onPaneClick}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  proOptions={{ hideAttribution: true }}
                  fitView
                  fitViewOptions={{ padding: 0.3 }}
              >
                  <Background color={isDarkTheme ? 'rgba(90,90,98,0.7)' : 'rgba(176,176,184,0.7)'} gap={18} size={1.2} />
                  <Controls
                    position="bottom-left"
                    showInteractive={false}
                    className={flowControlChromeClass}
                    style={{
                      bottom: bottomPanelOpen ? `${bottomPanelHeight + 12}px` : undefined,
                      transition: 'bottom 300ms ease-in-out',
                    }}
                  />
                  <MiniMap
                    position="bottom-right"
                    className={miniMapChromeClass}
                    nodeColor="#2563eb"
                  />
              </ReactFlow>
              </WorkflowEdgeDeleteContext.Provider>

              {/* Floating Execute (n8n-style) */}
              <div
                className="pointer-events-none absolute inset-x-0 z-20 flex justify-center transition-[bottom] duration-300 ease-in-out"
                style={{
                  bottom: bottomPanelOpen ? `${bottomPanelHeight + 16}px` : '16px',
                }}
              >
                <div className="pointer-events-auto flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    aria-label="Dry run"
                    variant="outline"
                    disabled={isRunInProgress}
                    onClick={() => handleRunWorkflow(true)}
                    className="h-9 rounded-full border-[rgb(var(--wb-color-border-subtle))] bg-[rgb(var(--wb-color-bg-surface))] px-3 shadow-[0_4px_14px_rgba(0,0,0,0.1)]"
                  >
                    <Activity size={14} />
                    Dry run
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    aria-label="Run"
                    disabled={!canSubmitWorkflow || isRunInProgress}
                    onClick={() => handleRunWorkflow(false)}
                    className="h-9 gap-2 rounded-full bg-[rgb(var(--wb-color-text-primary))] px-5 !text-[rgb(var(--wb-color-bg-base))] shadow-[0_6px_18px_rgba(0,0,0,0.18)] hover:bg-[rgb(var(--wb-color-text-primary)/0.9)] hover:!text-[rgb(var(--wb-color-bg-base))]"
                  >
                    <Play size={14} fill="currentColor" className="!text-[rgb(var(--wb-color-bg-base))]" />
                    <span className="!text-[rgb(var(--wb-color-bg-base))] font-semibold">Execute</span>
                  </Button>
                  {workflowStatus === 'Submitted' ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-label="View runs"
                      onClick={() => handlePlatformNavigation('workflows', 'workspace')}
                      className="h-9 rounded-full px-3 shadow-[0_4px_14px_rgba(0,0,0,0.1)]"
                    >
                      View runs
                    </Button>
                  ) : null}
                </div>
              </div>
          </div>

          {/* Canvas tools — zoom/fit live in bottom-left Controls */}
          <div
            className="pointer-events-auto absolute top-3 z-30 flex flex-col gap-1 rounded-md border border-[rgb(var(--wb-color-border-subtle))] bg-[rgb(var(--wb-color-bg-surface))] p-1 shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-[right] duration-300 ease-in-out"
            style={{
              right: rightPanelTab ? `calc(${inspectorWidthStyle} + 12px)` : '12px',
            }}
          >
            <Tooltip label="Auto-arrange layout" side="left">
              <button
                type="button"
                className={canvasToolBtnClass}
                aria-label="Auto-arrange layout"
                onClick={() => {
                  const layouted = getLayoutedElements(nodes, edges, layoutDirection);
                  setNodes([...layouted.nodes]);
                  setEdges([...layouted.edges]);
                  pushHistory(layouted.nodes, layouted.edges);
                  setTimeout(() => {
                    updateNodeInternals(layouted.nodes.map(n => n.id));
                    reactFlowInstance?.fitView({ padding: 0.25, duration: 600 });
                  }, 30);
                }}
              >
                <LayoutGrid size={15} />
              </button>
            </Tooltip>
            <Tooltip label={`Switch to ${layoutDirection === 'TB' ? 'horizontal' : 'vertical'} layout`} side="left">
              <button
                type="button"
                className={canvasToolBtnClass}
                aria-label="Toggle layout direction"
                onClick={() => {
                  const newDir = layoutDirection === 'TB' ? 'LR' : 'TB';
                  setLayoutDirection(newDir);
                  const layouted = getLayoutedElements(nodes, edges, newDir);
                  setNodes([...layouted.nodes]);
                  setEdges([...layouted.edges]);
                  pushHistory(layouted.nodes, layouted.edges);
                  setTimeout(() => {
                    updateNodeInternals(layouted.nodes.map(n => n.id));
                    reactFlowInstance?.fitView({ padding: 0.2, duration: 800 });
                  }, 30);
                }}
              >
                <Network size={15} className={layoutDirection === 'LR' ? 'rotate-90' : undefined} />
              </button>
            </Tooltip>
            <Tooltip label="Trace dependencies" side="left">
              <button
                type="button"
                className={`${canvasToolBtnClass} ${dagMode ? 'bg-[rgb(var(--wb-color-accent-primary)/0.12)] text-[rgb(var(--wb-color-accent-primary))]' : ''}`}
                aria-label="Trace dependencies"
                onClick={() => {
                  const newMode = !dagMode;
                  setDagMode(newMode);
                  if (!newMode) resetNodeStyles();
                }}
              >
                <GitMerge size={15} />
              </button>
            </Tooltip>
            <div className="mx-1 h-px bg-[rgb(var(--wb-color-border-subtle))]" />
            <Tooltip label={rightPanelTab ? "Close inspector" : "Toggle inspector"} side="left">
              <button
                type="button"
                className={`${canvasToolBtnClass} ${rightPanelTab ? 'bg-[rgb(var(--wb-color-accent-primary)/0.12)] text-[rgb(var(--wb-color-accent-primary))]' : ''}`}
                aria-label="Toggle inspector"
                ref={inspectorToggleRef}
                onClick={() => setRightPanelTab((current) => (current ? null : renderedRightTab))}
              >
                <PanelRight size={15} />
              </button>
            </Tooltip>
            <Tooltip label={bottomPanelOpen ? "Close bottom panel" : "Toggle bottom panel"} side="left">
              <button
                type="button"
                className={`${canvasToolBtnClass} ${bottomPanelOpen ? 'bg-[rgb(var(--wb-color-accent-primary)/0.12)] text-[rgb(var(--wb-color-accent-primary))]' : ''}`}
                aria-label="Toggle bottom panel"
                ref={bottomPanelToggleRef}
                onClick={() => setBottomPanelOpen((current) => !current)}
              >
                <PanelBottom size={15} />
              </button>
            </Tooltip>
            <Tooltip label="Analyze with AI" side="left">
              <button
                type="button"
                className={canvasToolBtnClass}
                aria-label="Analyze with AI"
                disabled={!canUseAI}
                onClick={handleAnalyze}
              >
                <Sparkles size={15} />
              </button>
            </Tooltip>
            {graphValidationErrors.length > 0 ? (
              <Tooltip label={`${graphValidationErrors.length} validation issues`} side="left">
                <button
                  type="button"
                  className={`${canvasToolBtnClass} text-[rgb(var(--wb-color-status-warning))]`}
                  aria-label="Open validation issues"
                  onClick={() => {
                    setBottomPanelOpen(true);
                    setBottomPanelTab('validation');
                  }}
                >
                  <TriangleAlert size={15} />
                </button>
              </Tooltip>
            ) : null}
          </div>

          {/* ── Persistent Bottom Panel (Overlay Drawer) ── */}
          <div
              data-testid="workflow-bottom-drawer"
              className={cn(
                "absolute bottom-0 left-0 z-20 flex flex-col border-t border-[rgb(var(--wb-color-border-subtle))] bg-[rgb(var(--wb-color-bg-surface))] shadow-[0_-8px_24px_rgba(0,0,0,0.12)] transition-all duration-300 ease-in-out",
                bottomPanelOpen ? "translate-y-0 pointer-events-auto" : "translate-y-full pointer-events-none"
              )}
              style={{
                height: `${bottomPanelHeight}px`,
                right: rightPanelTab ? inspectorWidthStyle : '0px',
                transitionProperty: isDraggingBottom.current ? 'none' : 'transform, right, height',
              }}
              aria-hidden={!bottomPanelOpen}
              inert={!bottomPanelOpen}
          >
              {/* Panel Tab Bar & Drag Handle */}
              <div
                  className="flex h-9 shrink-0 items-center border-b border-[rgb(var(--wb-color-border-subtle)/0.24)] select-none"
                  onMouseDown={handleBottomDragStart}
                  style={{ cursor: 'row-resize' }}
              >
                  <div className="flex shrink-0 items-center gap-0 border-r border-[rgb(var(--wb-color-border-subtle)/0.24)]" onMouseDown={(e) => e.stopPropagation()}>
                      {(['logs', 'validation'] as const).map(tab => (
                          <button
                              key={tab}
                              onClick={() => { setBottomPanelTab(tab); setBottomPanelOpen(true); }}
                              className={`flex h-9 items-center gap-1.5 border-r border-[rgb(var(--wb-color-border-subtle)/0.24)] px-4 text-xs font-medium capitalize transition-colors ${
                                  bottomPanelOpen && bottomPanelTab === tab
                                      ? 'bg-[rgb(var(--wb-color-bg-surface-hover))] text-[rgb(var(--wb-color-text-primary))]'
                                      : 'text-[rgb(var(--wb-color-text-secondary))] hover:bg-[rgb(var(--wb-color-bg-surface-hover))] hover:text-[rgb(var(--wb-color-text-primary))]'
                              }`}
                          >
                              {tab === 'logs' && <Terminal size={12} />}
                              {tab === 'validation' && (
                                  <span className="relative">
                                      <TriangleAlert size={12} />
                                      {graphValidationErrors.length > 0 && (
                                          <span className="absolute -right-1.5 -top-1.5 flex h-3 w-3 items-center justify-center rounded-full bg-[rgb(var(--wb-color-status-warning))] text-[8px] font-bold text-[rgb(var(--wb-color-bg-base))]">
                                              {graphValidationErrors.length}
                                          </span>
                                      )}
                                  </span>
                              )}
                              {tab.charAt(0).toUpperCase() + tab.slice(1)}
                          </button>
                      ))}
                  </div>

                  {/* Right side: clear logs + collapse toggle */}
                  <div className="flex items-center gap-1 ml-auto pr-2" onMouseDown={(e) => e.stopPropagation()}>
                      {bottomPanelTab === 'logs' && (
                          <button
                              onClick={() => setLogs('')}
                              className="rounded px-2 py-0.5 text-[10px] text-[rgb(var(--wb-color-text-muted))] transition-colors hover:bg-[rgb(var(--wb-color-bg-surface-hover))] hover:text-[rgb(var(--wb-color-text-primary))]"
                          >
                              Clear
                          </button>
                      )}
                      <button
                          onClick={() => {
                            setBottomPanelOpen(false);
                            bottomPanelToggleRef.current?.focus();
                          }}
                          className="rounded p-1 text-[rgb(var(--wb-color-text-muted))] transition-colors hover:bg-[rgb(var(--wb-color-bg-surface-hover))] hover:text-[rgb(var(--wb-color-text-primary))]"
                          title="Collapse panel"
                          aria-label="Collapse panel"
                      >
                          <ChevronDown size={14} />
                      </button>
                  </div>
              </div>

              {/* Panel Content */}
              <div className="flex-1 overflow-hidden">
                  {/* LOGS */}
                  {bottomPanelTab === 'logs' && (
                      <pre className="custom-scrollbar h-full overflow-y-auto p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-[rgb(var(--wb-color-status-success))]">
                          {logs || <span className="italic text-[rgb(var(--wb-color-text-muted))]">No log output yet. Run a workflow to see execution logs here.</span>}
                      </pre>
                  )}

                  {/* VALIDATION */}
                  {bottomPanelTab === 'validation' && (
                      <div className="h-full overflow-y-auto p-3 space-y-2 custom-scrollbar">
                          {graphValidationErrors.length === 0 ? (
                              <div className="flex items-center gap-2 text-sm text-[rgb(var(--wb-color-status-success))]">
                                  <CheckCircle2 size={16} />
                                  <span>No validation issues detected. Workflow looks good!</span>
                              </div>
                          ) : (
                              graphValidationErrors.map((err, i) => (
                              <div key={i} className="flex items-start gap-2 rounded-lg border border-[rgb(var(--wb-color-border-subtle)/0.28)] bg-[rgb(245_158_11/0.12)] p-2.5">
                                  <TriangleAlert size={14} className="mt-0.5 shrink-0 text-[rgb(var(--wb-color-status-warning))]" />
                                  <span className="font-mono text-xs text-[rgb(var(--wb-color-status-warning))]">{err}</span>
                              </div>
                              ))
                          )}
                      </div>
                  )}
              </div>
          </div>

          {/* RIGHT: Unified Config Panel & AI Chat (Overlay Drawer) */}
          <aside
            data-testid="workflow-inspector-drawer"
            className={cn(
              "absolute right-0 top-0 bottom-0 z-30 flex flex-col border-l border-[rgb(var(--wb-color-border-subtle))] bg-[rgb(var(--wb-color-bg-surface))] shadow-[-8px_0_24px_rgba(0,0,0,0.12)] transition-transform duration-300 ease-in-out",
              rightPanelTab ? "translate-x-0 pointer-events-auto" : "translate-x-full pointer-events-none"
            )}
            style={{
              width: inspectorWidthStyle,
            }}
            aria-hidden={!rightPanelTab}
            inert={!rightPanelTab}
          >
              <PlatformInspectorFrame
                  tabs={inspectorTabs}
                  activeTab={activeInspectorTab}
                  onTabChange={(tabId) => setRightPanelTab(tabId as 'config' | 'yaml' | 'ai')}
                  onClose={closeInspector}
                  width="100%"
                  className="h-full border-l-0 shadow-none"
              >
                  <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden wb-tokenized-panel">
                      {activeInspectorTab === 'yaml' ? (
                          <YamlPreview
                              nodes={nodes}
                              edges={edges}
                              metadata={wfMetadata}
                              spec={wfSpec}
                              onUpdate={handleYamlUpdate}
                              onClose={closeInspector}
                              modelPath={yamlModelPaths.pipelineInspector}
                              documentId={activeSessionId || undefined}
                          />
                      ) : activeInspectorTab === 'ai' ? (
                          <AIAssistant onGenerate={handleAiWorkflowGeneration} />
                      ) : activeInspectorTab === 'config' && inspectedNode ? (
                          <NodeConfigPanel
                              key={`${activeSessionId}:${inspectedNode.id}`}
                              selectedNode={inspectedNode}
                              onChange={onNodeUpdate}
                              onDelete={onNodeDelete}
                          />
                      ) : (
                          <div className="h-full p-6">
                              <PlatformEmptyState
                                  icon={<Settings size={30} />}
                                  title="Select a node"
                                  body="Choose a node on the canvas to configure properties, execution logic, and artifacts in the inspector."
                              />
                          </div>
                      )}
                  </div>
              </PlatformInspectorFrame>
          </aside>

      </div>
      ) : (
        <div className="min-h-0 flex-1 bg-[rgb(var(--wb-color-bg-base))]">
          <WorkflowLogsView logs={logs} canViewLogs={shell.permissions.canViewLogs} />
        </div>
      )}

      {/* YAML lives in the right inspector — bottom panel is logs + validation only */}

      {/* Error Toast */}
      {errorMsg && (
          <div className="fixed left-1/2 top-20 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[rgb(var(--wb-color-border-subtle)/0.28)] bg-[rgb(239_68_68/0.92)] px-6 py-3 text-white shadow-2xl backdrop-blur">
              <XCircle size={20} className="shrink-0" />
              <span className="text-sm font-bold">{errorMsg}</span>
              <button
                onClick={() => setErrorMsg(null)}
                className="ml-2 rounded-full p-1 transition-colors hover:bg-[rgba(255,255,255,0.16)]"
              >
                <XCircle size={16} />
              </button>
          </div>
      )}

      <AnalysisModal
        isOpen={showAnalysis}
        onClose={() => setShowAnalysis(false)}
        result={analysisResult}
        isLoading={isAnalyzing}
      />

      <WorkflowSettings
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        metadata={wfMetadata}
        spec={wfSpec}
        onSave={handleSettingsSave}
      />

      <ImportModal
         isOpen={showImportModal}
         onClose={() => { setShowImportModal(false); setPendingImport(null); }}
         onReplace={handleImportReplace}
         onNewTab={handleImportNewTab}
         fileName={pendingImport?.fileName}
      />

      <ConfirmationDialog
        open={Boolean(confirmationDialog)}
        title={confirmationDialog?.title || ''}
        message={confirmationDialog?.message || ''}
        confirmLabel={confirmationDialog?.confirmLabel}
        tone={confirmationDialog?.tone}
        onClose={() => setConfirmationDialog(null)}
        onConfirm={() => confirmationDialog?.onConfirm()}
      />
    </div>
  );

  const sectionBody =
    activeSection === 'workflows' ? (
      <WorkflowsSection
        namespace={shell.namespaceScope}
        notificationPreferences={notificationPreferences}
      />
    ) : (
      body
    );

  const previewChrome = (
    <PlatformPreviewFrame
      rail={
        <PlatformRail
          brand={<img src={brandMarkSrc} alt={brandName} className="h-6 w-6 object-contain" draggable={false} />}
          brandSurface="plain"
          items={[
            { id: 'pipelines', label: 'Pipelines', icon: <GitBranch size={16} />, active: activePreviewSection === 'pipelines', onClick: () => handlePlatformNavigation('pipelines', 'rail') },
            { id: 'workflows', label: 'Workflows', icon: <Activity size={16} />, active: activePreviewSection === 'workflows', onClick: () => handlePlatformNavigation('workflows', 'rail') },
          ]}
          footerItems={[
            { id: 'theme', label: previewThemeLabel, icon: nextThemeIcon, onClick: toggleTheme },
            { id: 'profile', label: 'Profile', icon: <User size={16} />, active: activePreviewSection === 'profile', onClick: () => handlePlatformNavigation('profile', 'rail') },
          ]}
        />
      }
    >
      {sectionBody}
    </PlatformPreviewFrame>
  );

  return renderMode === 'preview' ? previewChrome : sectionBody;
};

export function WorkflowBuilderApp({ shell }: { shell: WorkflowBuilderProps }) {
  return (
    <ReactFlowProvider>
      <Flow shell={shell} renderMode="embedded" />
    </ReactFlowProvider>
  );
}

export function WorkflowBuilderPreviewApp({ shell }: { shell: WorkflowBuilderProps }) {
  return (
    <ReactFlowProvider>
      <Flow shell={shell} renderMode="preview" />
    </ReactFlowProvider>
  );
}
