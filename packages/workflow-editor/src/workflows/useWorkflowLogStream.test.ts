import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getWorkflowRuntime, initializeWorkflowRuntime } from "../platform/runtime";
import { useWorkflowLogStream } from "./useWorkflowLogStream";
import type { WorkflowLogStreamChunk } from "@argocanvas/workflow-domain";

const originalRuntime = getWorkflowRuntime();

afterEach(() => initializeWorkflowRuntime(originalRuntime));

describe("workflow log selection", () => {
  it("clears the previous run's logs before appending the selected run's stream", async () => {
    const streamWorkflowLogs = vi.fn(async (_namespace: string, name: string) => ({
      events: [{ cursor: name, message: `${name} output` }], cursor: name,
    }));
    initializeWorkflowRuntime({ ...originalRuntime, clients: { ...originalRuntime.clients, workflows: { ...originalRuntime.clients.workflows, streamWorkflowLogs } } });
    const { result, rerender } = renderHook(({ name }) => useWorkflowLogStream({ enabled: true, namespace: "default", workflowName: name }), { initialProps: { name: "first" } });

    await waitFor(() => expect(result.current.logs).toBe("first output"));
    rerender({ name: "second" });
    await waitFor(() => expect(result.current.logs).toBe("second output"));
    expect(streamWorkflowLogs).toHaveBeenLastCalledWith("default", "second", { cursor: undefined, podName: undefined });
  });

  it("does not switch a new run to fallback when an old stream rejects after selection changes", async () => {
    let rejectOld!: (error: Error) => void;
    const oldRequest = new Promise<WorkflowLogStreamChunk>((_resolve, reject) => { rejectOld = reject; });
    const streamWorkflowLogs = vi.fn((_namespace: string, name: string) => name === "first" ? oldRequest : Promise.resolve({ events: [{ cursor: name, message: "second output" }], cursor: name }));
    const getWorkflowLogs = vi.fn(async () => "fallback output");
    initializeWorkflowRuntime({ ...originalRuntime, clients: { ...originalRuntime.clients, workflows: { ...originalRuntime.clients.workflows, streamWorkflowLogs, getWorkflowLogs } } });
    const { result, rerender } = renderHook(({ name }) => useWorkflowLogStream({ enabled: true, namespace: "default", workflowName: name }), { initialProps: { name: "first" } });

    rerender({ name: "second" });
    await waitFor(() => expect(result.current.logs).toBe("second output"));
    await act(async () => rejectOld(new Error("old request timed out")));

    expect(getWorkflowLogs).not.toHaveBeenCalled();
    expect(result.current.mode).toBe("stream");
    expect(result.current.logs).toBe("second output");
  });
});
