import { getWorkflowRuntime, type WorkflowDraft } from "./runtime";

const scopedKey = (key: string) => {
  const { workspaceId, projectId } = getWorkflowRuntime().shell;
  return `${key}:${workspaceId}:${projectId}`;
};
const readJson = (key: string, fallback: unknown) => {
  try { return JSON.parse(localStorage.getItem(scopedKey(key)) || JSON.stringify(fallback)); }
  catch { return fallback; }
};

const draftMirrorKey = "flowgo-sessions-v2";
const draftActiveMirrorKey = "flowgo-active-id-v2";

export const draftMirrorStorage = {
  save(draft: WorkflowDraft) {
    try {
      localStorage.setItem(scopedKey(draftMirrorKey), JSON.stringify(draft.sessions));
      if (draft.activeSessionId) localStorage.setItem(scopedKey(draftActiveMirrorKey), draft.activeSessionId);
      else localStorage.removeItem(scopedKey(draftActiveMirrorKey));
    } catch { /* Storage may be disabled or full. Remote saves still work. */ }
  },
  load() {
    const parsed = readJson(draftMirrorKey, []);
    const sessions = Array.isArray(parsed) ? parsed : [];
    let activeSessionId: string | null = null;
    try { activeSessionId = localStorage.getItem(scopedKey(draftActiveMirrorKey)); } catch { /* unavailable */ }
    return { sessions, activeSessionId };
  },
};
