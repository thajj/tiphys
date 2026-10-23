import { Terminal } from "lucide-react";
import { PlatformEmptyState } from "@argocanvas/ui-platform";

export function WorkflowLogsView(props: {
  logs: string;
  canViewLogs: boolean;
  compact?: boolean;
}) {
  if (!props.canViewLogs) {
    return (
      <div className={props.compact ? "h-full p-3" : "flex-1 p-6"}>
        <PlatformEmptyState
          icon={<Terminal size={28} />}
          title="Execution logs are restricted"
          body="The platform has disabled log visibility for the current role or environment."
        />
      </div>
    );
  }

  if (!props.logs) {
    return (
      <div className={props.compact ? "h-full p-3" : "flex-1 p-6"}>
        <PlatformEmptyState
          icon={<Terminal size={28} />}
          title="No execution logs yet"
          body="Run a dry run or submit the workflow to stream operational output into this console."
        />
      </div>
    );
  }

  return (
    <pre className="h-full overflow-y-auto bg-[rgb(var(--wb-color-bg-base))] p-4 text-[11px] leading-relaxed text-emerald-400">
      {props.logs}
    </pre>
  );
}
