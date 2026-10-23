import { useEffect, useRef, useState } from "react";
import { getWorkflowRuntime } from "../platform/runtime";

type UseWorkflowLogStreamInput = {
  enabled: boolean;
  namespace?: string;
  workflowName?: string;
  podName?: string;
  initialLogs?: string;
  pollMs?: number;
};

export function useWorkflowLogStream(input: UseWorkflowLogStreamInput) {
  const runtime = getWorkflowRuntime();
  const [logs, setLogs] = useState(input.initialLogs || "");
  const [mode, setMode] = useState<"stream" | "fallback">("stream");
  const cursorRef = useRef<string | undefined>(undefined);
  const fallbackRef = useRef(false);

  useEffect(() => {
    setLogs(input.initialLogs || "");
  }, [input.initialLogs, input.namespace, input.workflowName, input.podName]);

  useEffect(() => {
    cursorRef.current = undefined;
    fallbackRef.current = false;
    setMode("stream");

    if (!input.enabled || !input.namespace || !input.workflowName) {
      return;
    }

    let cancelled = false;

    const tick = async () => {
      if (!input.namespace || !input.workflowName) {
        return;
      }

      if (
        runtime.shell.featureFlags.logStreaming !== false &&
        !fallbackRef.current
      ) {
        try {
          const response = await runtime.clients.workflows.streamWorkflowLogs(
            input.namespace,
            input.workflowName,
            {
              podName: input.podName,
              cursor: cursorRef.current,
            },
          );

          if (cancelled) {
            return;
          }

          cursorRef.current = response.cursor || cursorRef.current;
          if (response.events.length > 0) {
            setLogs((current) => {
              const chunk = response.events.map((event) => event.message).join("\n");
              return (current ? `${current}\n${chunk}` : chunk).slice(-1024 * 1024);
            });
          }
          setMode("stream");
          return;
        } catch {
          if (cancelled) return;
          fallbackRef.current = true;
          setMode("fallback");
        }
      }

      try {
        const nextLogs = await runtime.clients.workflows.getWorkflowLogs(
          input.namespace,
          input.workflowName,
          input.podName,
        );
        if (!cancelled) {
          setLogs(nextLogs.slice(-1024 * 1024));
        }
      } catch {
        // Keep the latest successful log state visible.
      }
    };

    let timer: number | undefined;
    const poll = async () => {
      await tick();
      if (!cancelled) timer = window.setTimeout(poll, input.pollMs || 2000);
    };
    void poll();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    input.enabled,
    input.namespace,
    input.workflowName,
    input.podName,
    input.pollMs,
    runtime.clients.workflows,
    runtime.shell.featureFlags.logStreaming,
  ]);

  return { logs, mode };
}
