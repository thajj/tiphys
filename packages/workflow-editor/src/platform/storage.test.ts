import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getWorkflowRuntime, initializeWorkflowRuntime } from "./runtime";
import { draftMirrorStorage } from "./storage";

describe("browser draft isolation", () => {
  const runtime = getWorkflowRuntime();
  beforeEach(() => { localStorage.clear(); initializeWorkflowRuntime(runtime); });
  afterEach(() => vi.restoreAllMocks());
  it("does not restore another user's draft on a shared browser", () => {
    initializeWorkflowRuntime({ ...runtime, shell: { ...runtime.shell, workspaceId: "alice" } });
    draftMirrorStorage.save({ sessions: [], activeSessionId: "alice-session", savedAt: 1 });
    initializeWorkflowRuntime({ ...runtime, shell: { ...runtime.shell, workspaceId: "bob" } });
    expect(draftMirrorStorage.load().activeSessionId).toBeNull();
    initializeWorkflowRuntime({ ...runtime, shell: { ...runtime.shell, workspaceId: "alice" } });
    expect(draftMirrorStorage.load().activeSessionId).toBe("alice-session");
  });
  it("ignores corrupt backups and clears stale active-session identifiers", () => {
    localStorage.setItem(`flowgo-sessions-v2:${runtime.shell.workspaceId}:${runtime.shell.projectId}`, "{invalid");
    expect(draftMirrorStorage.load().sessions).toEqual([]);
    draftMirrorStorage.save({ sessions: [], activeSessionId: "old", savedAt: 1 });
    draftMirrorStorage.save({ sessions: [], activeSessionId: null, savedAt: 2 });
    expect(draftMirrorStorage.load().activeSessionId).toBeNull();
  });
});
