import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildWorkflowListSearchParams,
  createFetchDraftsClient,
  createFetchWorkflowTemplatesClient,
  createFetchWorkflowsClient,
} from "./runtime";

const shell = {
  namespaceScope: "default",
  telemetry: {
    track: vi.fn(),
  },
};

describe("platform runtime clients", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("normalizes workflow list responses from items envelopes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ items: [{ metadata: { name: "demo" } }] }),
      }),
    );

    const client = createFetchWorkflowsClient(shell);
    const result = await client.listWorkflows();

    expect(result).toHaveLength(1);
  });

  it("extracts message fields from JSON error payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ code: 16, message: "token not valid" }),
      }),
    );

    const client = createFetchWorkflowsClient(shell);

    await expect(client.listWorkflowTemplates()).rejects.toThrow("token not valid");
  });

  it("serializes workflow page queries for the Argo proxy contract", () => {
    const params = buildWorkflowListSearchParams({
      limit: 25,
      cursor: "page-2",
      phases: ["Succeeded", "Failed"],
      nameEquals: "demo-workflow",
      fields: "items.metadata.name",
    });

    expect(params.get("limit")).toBe("25");
    expect(params.get("cursor")).toBe("page-2");
    expect(params.get("phases")).toBe("Succeeded,Failed");
    expect(params.get("nameEquals")).toBe("demo-workflow");
    expect(params.get("fields")).toBe("items.metadata.name");
  });

  it("maps paged workflow list responses into workflow list pages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          metadata: { continue: "page-2", resourceVersion: "17" },
          items: [{ metadata: { name: "demo", namespace: "default" }, spec: { entrypoint: "main", templates: [] } }],
        }),
      }),
    );

    const client = createFetchWorkflowsClient(shell);
    const page = await client.listWorkflowPage({
      namespace: "default",
      limit: 10,
      phases: ["Succeeded"],
    });

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe("page-2");
    expect(page.resourceVersion).toBe("17");
    expect(fetch).toHaveBeenCalledWith(
      "/api/platform/workflows/default?limit=10&phases=Succeeded",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("falls back to local backup when remote drafts are unavailable", async () => {
    localStorage.setItem(
      "workflow-builder:draft:workspace:project",
      JSON.stringify({ sessions: [{ id: "session-1" }], activeSessionId: "session-1", savedAt: 1 }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        text: async () => "unavailable",
      }),
    );

    const client = createFetchDraftsClient(shell);
    const result = await client.loadDraft("workspace", "project");

    expect(result?.activeSessionId).toBe("session-1");
  });
  it("reports failed remote saves instead of confirming persistence from a local backup", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const draft = { sessions: [], activeSessionId: null, savedAt: 1 };
    await expect(createFetchDraftsClient(shell).saveDraft("workspace", "project", draft)).rejects.toThrow("offline");
    expect(JSON.parse(localStorage.getItem("workflow-builder:draft:workspace:project")!)).toEqual(draft);
  });

  it("maps workflow template client to the platform endpoints", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => [{ metadata: { name: "demo-template" }, spec: { entrypoint: "main", templates: [] } }],
      }),
    );

    await expect(createFetchWorkflowTemplatesClient(shell).list()).resolves.toHaveLength(1);

    expect(fetch).toHaveBeenNthCalledWith(1, "/api/platform/workflow-templates/default", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("maps log-stream requests to the platform endpoints", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            events: [{ cursor: "1", message: "line 1" }],
            cursor: "1",
            complete: false,
          }),
        }),
    );

    const workflowClient = createFetchWorkflowsClient(shell);

    await expect(
      workflowClient.streamWorkflowLogs("default", "demo-run", { cursor: "0" }),
    ).resolves.toMatchObject({
      events: [{ message: "line 1" }],
      cursor: "1",
    });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/platform/workflows/default/demo-run/logs/stream?cursor=0",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
