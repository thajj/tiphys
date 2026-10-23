import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

export function createDraftStore(dataDir: string) {
  const directory = path.join(dataDir, "drafts");
  const filename = (subject: string, workspace: string, project: string) =>
    path.join(directory, `${createHash("sha256").update(JSON.stringify([subject, workspace, project])).digest("hex")}.json`);
  return {
    async initialize() { await mkdir(directory, { recursive: true, mode: 0o700 }); },
    async load(subject: string, workspace: string, project: string) {
      try { return JSON.parse(await readFile(filename(subject, workspace, project), "utf8")); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async save(subject: string, workspace: string, project: string, draft: unknown) {
      const destination = filename(subject, workspace, project);
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        const handle = await open(temporary, "wx", 0o600);
        try { await handle.writeFile(JSON.stringify(draft)); await handle.sync(); }
        finally { await handle.close(); }
        await rename(temporary, destination);
        const dir = await open(directory, "r");
        try { await dir.sync(); } finally { await dir.close(); }
      } finally { await unlink(temporary).catch(() => {}); }
      return draft;
    },
  };
}
