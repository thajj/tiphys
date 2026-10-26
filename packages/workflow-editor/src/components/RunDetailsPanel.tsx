import type { ReactNode } from "react";
import { Clock3, Terminal } from "lucide-react";
import { PlatformEmptyState, PlatformStatusBadge } from "@tiphys/ui-platform";
import { useWorkflowLogStream } from "../workflows/useWorkflowLogStream";

type RunDetailsPanelProps = {
  title: string;
  workflowName: string;
  namespace: string;
  status?: string;
  startedAt?: string | number;
  updatedAt?: string | number;
  outputUri?: string;
  subtitle?: string;
  initialLogs?: string;
  canViewLogs?: boolean;
  actions?: ReactNode;
};

const formatTimestamp = (value?: string | number) => {
  if (!value) {
    return "Unavailable";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Unavailable" : parsed.toLocaleString();
};

const getStatusTone = (phase?: string): "default" | "success" | "warning" | "danger" | "info" => {
  if (phase === "Succeeded") {
    return "success";
  }
  if (phase === "Failed" || phase === "Error") {
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

export function RunDetailsPanel(props: RunDetailsPanelProps) {
  const { logs, mode } = useWorkflowLogStream({
    enabled: props.canViewLogs !== false,
    namespace: props.namespace,
    workflowName: props.workflowName,
    initialLogs: props.initialLogs,
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-[rgb(var(--wb-color-border-subtle)/0.65)] px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[rgb(var(--wb-color-text-muted))]">
              {props.title}
            </p>
            <h3 className="mt-2 truncate text-lg font-semibold text-[rgb(var(--wb-color-text-primary))]">
              {props.workflowName}
            </h3>
            <p className="mt-1 text-sm text-[rgb(var(--wb-color-text-secondary))]">
              {props.subtitle || props.namespace}
            </p>
          </div>
          <PlatformStatusBadge tone={getStatusTone(props.status)}>
            {props.status || "Unknown"}
          </PlatformStatusBadge>
        </div>
        {props.actions ? <div className="mt-4">{props.actions}</div> : null}
      </div>

      <div className="custom-scrollbar flex-1 overflow-y-auto px-5 py-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-[rgb(var(--wb-color-border-strong))] bg-[rgb(var(--wb-color-bg-surface-active))] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[rgb(var(--wb-color-text-muted))]">
              Started
            </p>
            <p className="mt-2 text-sm text-[rgb(var(--wb-color-text-primary))]">
              {formatTimestamp(props.startedAt)}
            </p>
          </div>
          <div className="rounded-2xl border border-[rgb(var(--wb-color-border-strong))] bg-[rgb(var(--wb-color-bg-surface-active))] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[rgb(var(--wb-color-text-muted))]">
              Updated
            </p>
            <p className="mt-2 text-sm text-[rgb(var(--wb-color-text-primary))]">
              {formatTimestamp(props.updatedAt)}
            </p>
          </div>
        </div>

        {props.outputUri ? (
          <div className="mt-4 rounded-2xl border border-[rgb(var(--wb-color-border-strong))] bg-[rgb(var(--wb-color-bg-surface-active))] p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-[rgb(var(--wb-color-text-muted))]">
              <Clock3 size={12} />
              Output
            </div>
            <div className="mt-2 break-all text-sm text-[rgb(var(--wb-color-text-primary))]">
              {props.outputUri}
            </div>
          </div>
        ) : null}

        <div className="mt-4 overflow-hidden rounded-2xl border border-[rgb(var(--wb-color-border-strong))] bg-[rgb(var(--wb-color-bg-surface-active))]">
          <div className="flex items-center justify-between border-b border-[rgb(var(--wb-color-border-subtle)/0.65)] px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-[rgb(var(--wb-color-text-muted))]">
              <Terminal size={12} />
              Logs
            </div>
            <PlatformStatusBadge tone={mode === "stream" ? "info" : "warning"}>
              {mode === "stream" ? "Incremental stream" : "Fallback polling"}
            </PlatformStatusBadge>
          </div>
          {props.canViewLogs === false ? (
            <div className="p-4">
              <PlatformEmptyState
                icon={<Terminal size={24} />}
                title="Logs are restricted"
                body="The platform has disabled workflow log access for the current role."
              />
            </div>
          ) : (
            <pre className="max-h-[22rem] overflow-y-auto px-4 py-4 text-[11px] leading-relaxed text-emerald-400">
              {logs || "Waiting for workflow logs…"}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
