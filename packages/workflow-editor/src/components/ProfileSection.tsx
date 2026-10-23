import type { ReactNode } from "react";
import {
  Activity,
  Bell,
  CheckCircle2,
  GitBranch,
  MoonStar,
  Settings,
  SunMedium,
  Terminal,
  XCircle,
} from "lucide-react";
import type {
  BrowserNotificationCategory,
  BrowserNotificationPreferences,
} from "../platform/notificationPreferences";
import type {
  PlatformSectionRoute,
  WorkflowBuilderFeatureFlags,
  WorkflowBuilderPermissions,
} from "@argocanvas/platform-sdk";
import { Button, PlatformStatusBadge, cn } from "@argocanvas/ui-platform";

type ProfileHomeSection = Extract<PlatformSectionRoute, "pipelines" | "workflows">;

type ProfilePipelineView = "pipeline" | "logs";

type ProfileSectionProps = {
  workspaceId: string;
  projectId: string;
  namespaceScope: string;
  workflowName: string;
  workflowNamespace: string;
  workflowStatus: string;
  entrypoint: string;
  sessionCount: number;
  activeSessionName?: string | null;
  teamLabel?: string;
  currentTheme: "dark" | "light";
  preferredHomeSection: ProfileHomeSection;
  preferredPipelineView: ProfilePipelineView;
  featureFlags: WorkflowBuilderFeatureFlags;
  permissions: WorkflowBuilderPermissions;
  notificationPreferences: BrowserNotificationPreferences;
  notificationPermission: string;
  onThemeChange: (theme: "dark" | "light") => void;
  onPreferredHomeSectionChange: (section: ProfileHomeSection) => void;
  onPreferredPipelineViewChange: (view: ProfilePipelineView) => void;
  onNotificationPreferencesChange: (preferences: BrowserNotificationPreferences) => void;
  onRequestNotificationPermission: () => void;
  onSendTestNotification: () => void;
};

const cardClassName =
  "rounded-2xl border border-[rgb(var(--wb-color-border-subtle)/0.84)] bg-[rgb(var(--wb-color-bg-surface))] p-4 md:p-5";
const cardTitleClassName = "text-lg font-bold tracking-tight text-[rgb(var(--wb-color-text-primary))]";
const cardSubtitleClassName = "mt-1 text-sm text-[rgb(var(--wb-color-text-secondary))]";
const overlineClassName =
  "text-xs font-semibold uppercase tracking-wider text-[rgb(var(--wb-color-text-secondary))]";
const dividerClassName = "border-t border-[rgb(var(--wb-color-border-subtle)/0.8)]";

function Chip(props: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-[rgb(var(--wb-color-border-subtle)/0.9)] bg-[rgb(var(--wb-color-bg-surface)/0.7)] px-2.5 py-1 text-xs font-medium text-[rgb(var(--wb-color-text-primary))]">
      {props.children}
    </span>
  );
}

function PreferenceButton(props: {
  active: boolean;
  icon: ReactNode;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={props.active ? "default" : "outline"}
      onClick={props.onClick}
      className="h-auto min-w-0 flex-1 justify-start rounded-xl px-3 py-2.5"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="flex items-center justify-center">{props.icon}</span>
        <span className="min-w-0 text-left">
          <span className="block text-sm font-bold">{props.label}</span>
          <span
            className={cn(
              "block text-xs font-normal",
              props.active ? "text-white/80" : "text-[rgb(var(--wb-color-text-secondary))]",
            )}
          >
            {props.description}
          </span>
        </span>
      </span>
    </Button>
  );
}

function ContextRow(props: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[rgb(var(--wb-color-border-subtle)/0.6)] py-2.5">
      <span className="text-sm text-[rgb(var(--wb-color-text-secondary))]">{props.label}</span>
      <span className="max-w-[60%] break-words text-right text-sm font-semibold">{props.value}</span>
    </div>
  );
}

export function ProfileSection(props: ProfileSectionProps) {
  const toggleNotificationCategory = (category: BrowserNotificationCategory) => {
    props.onNotificationPreferencesChange({
      ...props.notificationPreferences,
      categories: {
        ...props.notificationPreferences.categories,
        [category]: !props.notificationPreferences.categories[category],
      },
    });
  };

  const capabilityItems = [
    {
      label: "Workflow edits",
      enabled: props.permissions.canEditWorkflow,
    },
    {
      label: "Workflow submit",
      enabled: props.permissions.canSubmitWorkflow,
    },
    {
      label: "AI assistant",
      enabled: props.featureFlags.aiAssistant && props.permissions.canUseAI,
    },
    {
      label: "Execution logs",
      enabled: props.permissions.canViewLogs,
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      <div className="flex flex-col gap-6">
        <section className="overflow-hidden rounded-2xl border border-[rgb(var(--wb-color-border-subtle)/0.84)] bg-gradient-to-br from-[rgb(var(--wb-color-accent-primary)/0.16)] to-[rgb(var(--wb-color-accent-primary)/0.04)] p-5 md:p-6">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <PlatformStatusBadge tone="info">Profile</PlatformStatusBadge>
              <PlatformStatusBadge tone="success">Local preferences</PlatformStatusBadge>
              <Chip>{`Namespace ${props.namespaceScope}`}</Chip>
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight">Customize your builder experience</h1>
            <p className="max-w-[840px] text-sm text-[rgb(var(--wb-color-text-secondary))]">
              This page keeps the left-rail destination user-focused: it stores local interface
              defaults and surfaces the Argo-relevant execution context currently bound to this
              workspace.
            </p>
            <div className="flex flex-wrap gap-2">
              <Chip>{`Workspace ${props.workspaceId}`}</Chip>
              <Chip>{`Project ${props.projectId}`}</Chip>
              <Chip>{`Workflow ${props.workflowName}`}</Chip>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <section className={cardClassName}>
            <div className="flex flex-col gap-4">
              <div>
                <h2 className={cardTitleClassName}>Experience Preferences</h2>
                <p className={cardSubtitleClassName}>
                  Preferences are stored in this browser and reused the next time the builder opens.
                </p>
              </div>

              <div>
                <p className={overlineClassName}>Theme</p>
                <div className="mt-2 flex flex-col gap-2.5 sm:flex-row">
                  <PreferenceButton
                    active={props.currentTheme === "dark"}
                    icon={<MoonStar size={16} />}
                    label="Dark"
                    description="Lower-glare surfaces for dense workflow editing."
                    onClick={() => props.onThemeChange("dark")}
                  />
                  <PreferenceButton
                    active={props.currentTheme === "light"}
                    icon={<SunMedium size={16} />}
                    label="Light"
                    description="Higher-contrast paper surfaces for reviews and demos."
                    onClick={() => props.onThemeChange("light")}
                  />
                </div>
              </div>

              <hr className={dividerClassName} />

              <div>
                <p className={overlineClassName}>Preferred Landing Section</p>
                <div className="mt-2 flex flex-col gap-2.5 sm:flex-row">
                  <PreferenceButton
                    active={props.preferredHomeSection === "pipelines"}
                    icon={<GitBranch size={16} />}
                    label="Pipelines"
                    description="Open the DAG builder by default."
                    onClick={() => props.onPreferredHomeSectionChange("pipelines")}
                  />
                  <PreferenceButton
                    active={props.preferredHomeSection === "workflows"}
                    icon={<Activity size={16} />}
                    label="Workflows"
                    description="Start from run monitoring and status."
                    onClick={() => props.onPreferredHomeSectionChange("workflows")}
                  />
                </div>
              </div>

              <hr className={dividerClassName} />

              <div>
                <p className={overlineClassName}>Preferred Pipeline Workspace</p>
                <div className="mt-2 flex flex-col gap-2.5 sm:flex-row">
                  <PreferenceButton
                    active={props.preferredPipelineView === "pipeline"}
                    icon={<GitBranch size={16} />}
                    label="Pipeline DAG"
                    description="Keep the graph editor front and center."
                    onClick={() => props.onPreferredPipelineViewChange("pipeline")}
                  />
                  <PreferenceButton
                    active={props.preferredPipelineView === "logs"}
                    icon={<Terminal size={16} />}
                    label="Execution Logs"
                    description="Bias the workspace toward operational debugging."
                    onClick={() => props.onPreferredPipelineViewChange("logs")}
                  />
                </div>
              </div>
            </div>
          </section>

          <div className="flex flex-col gap-6">
            <section className={cardClassName}>
              <div className="flex flex-col gap-4">
                <div>
                  <h2 className={cardTitleClassName}>Argo Context</h2>
                  <p className={cardSubtitleClassName}>Runtime metadata available to this builder session.</p>
                </div>
                <div>
                  <ContextRow label="Namespace scope" value={props.namespaceScope} />
                  <ContextRow label="Workflow namespace" value={props.workflowNamespace} />
                  <ContextRow label="Workflow entrypoint" value={props.entrypoint} />
                  <ContextRow label="Workflow status" value={props.workflowStatus} />
                  <ContextRow label="Active session" value={props.activeSessionName ?? "Draft 1"} />
                  <ContextRow label="Open sessions" value={String(props.sessionCount)} />
                  {props.teamLabel ? <ContextRow label="Team label" value={props.teamLabel} /> : null}
                </div>
              </div>
            </section>

            <section className={cardClassName}>
              <div className="flex flex-col gap-4">
                <div>
                  <h2 className={cardTitleClassName}>Access Snapshot</h2>
                  <p className={cardSubtitleClassName}>
                    Effective capabilities and feature gates for the current profile.
                  </p>
                </div>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2.5">
                  {capabilityItems.map((item) => (
                    <div
                      key={item.label}
                      className={cn(
                        "flex items-center gap-2 rounded-2xl border border-[rgb(var(--wb-color-border-subtle)/0.74)] px-3 py-2.5",
                        item.enabled
                          ? "bg-[rgb(var(--wb-color-status-success)/0.08)]"
                          : "bg-[rgb(var(--wb-color-text-secondary)/0.06)]",
                      )}
                    >
                      {item.enabled ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                      <span className="text-sm font-semibold">{item.label}</span>
                    </div>
                  ))}
                </div>
                <div className="rounded-xl border border-dashed border-[rgb(var(--wb-color-border-subtle)/0.92)] px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Settings size={16} className="shrink-0" />
                    <p className="text-sm text-[rgb(var(--wb-color-text-secondary))]">
                      Identity fields like email, groups, or SSO claims are not exposed by the current
                      shell contract yet, so this profile focuses on the execution context the app can
                      show accurately today.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section className={cardClassName}>
              <div className="flex flex-col gap-4">
                <div>
                  <h2 className={cardTitleClassName}>Browser Notifications</h2>
                  <p className={cardSubtitleClassName}>Local browser alerts for workflow runs.</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <PlatformStatusBadge
                    tone={
                      props.notificationPermission === "granted"
                        ? "success"
                        : props.notificationPermission === "denied"
                          ? "danger"
                          : "warning"
                    }
                  >
                    Permission {props.notificationPermission}
                  </PlatformStatusBadge>
                  <PlatformStatusBadge tone={props.notificationPreferences.muteAll ? "warning" : "info"}>
                    {props.notificationPreferences.muteAll ? "Muted" : "Active"}
                  </PlatformStatusBadge>
                </div>

                <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2.5">
                  {(
                    [
                      ["workflowSucceeded", "Workflow success"],
                      ["workflowFailed", "Workflow failure"],
                    ] as Array<[BrowserNotificationCategory, string]>
                  ).map(([category, label]) => (
                    <Button
                      key={category}
                      type="button"
                      variant={props.notificationPreferences.categories[category] ? "default" : "outline"}
                      onClick={() => toggleNotificationCategory(category)}
                      className="justify-start"
                    >
                      <Bell size={14} />
                      {label}
                    </Button>
                  ))}
                </div>

                <div className="flex flex-col gap-2.5 sm:flex-row">
                  <Button
                    type="button"
                    variant={props.notificationPreferences.muteAll ? "default" : "outline"}
                    onClick={() =>
                      props.onNotificationPreferencesChange({
                        ...props.notificationPreferences,
                        muteAll: !props.notificationPreferences.muteAll,
                      })
                    }
                  >
                    {props.notificationPreferences.muteAll ? "Unmute all" : "Mute all"}
                  </Button>
                  <Button type="button" variant="outline" onClick={props.onRequestNotificationPermission}>
                    Request permission
                  </Button>
                  <Button type="button" variant="outline" onClick={props.onSendTestNotification}>
                    Send test notification
                  </Button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
