import fs from "node:fs";
import path from "path";

export interface DevProxyEnv {
  argoEndpoint: string;
  argoNamespace: string;
  argoToken: string;
  geminiApiKey: string;
  geminiModel?: string;
}

const stripWrappingQuotes = (value: string) => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

export const recoverLooseEnvBindings = (contents: string) => {
  const recovered: Record<string, string> = {};

  contents.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const exportMatch = trimmed.match(/^(?:(VITE_)?)export\s+([A-Z0-9_]+)\s*=\s*(.+)$/);
    if (exportMatch) {
      const [, prefix = "", key, value] = exportMatch;
      recovered[`${prefix}${key}`] = stripWrappingQuotes(value);
      return;
    }

    const assignmentMatch = trimmed.match(/^([A-Z0-9_]+)\s*=\s*(.+)$/);
    if (assignmentMatch) {
      const [, key, value] = assignmentMatch;
      recovered[key] = stripWrappingQuotes(value);
    }
  });

  return recovered;
};

const loadLooseEnvBindings = (envDir: string, mode: string) => {
  const files = [".env", ".env.local", `.env.${mode}`, `.env.${mode}.local`];

  return files.reduce<Record<string, string>>((acc, fileName) => {
    const filePath = path.join(envDir, fileName);
    if (!fs.existsSync(filePath)) {
      return acc;
    }

    return {
      ...acc,
      ...recoverLooseEnvBindings(fs.readFileSync(filePath, "utf8")),
    };
  }, {});
};

export const normalizeAuthHeaderValue = (token: string | undefined) => {
  if (!token) {
    return "";
  }

  const normalizedToken = stripWrappingQuotes(token);
  if (!normalizedToken) {
    return "";
  }

  return /^Bearer\s+/i.test(normalizedToken)
    ? normalizedToken
    : `Bearer ${normalizedToken}`;
};

export const geminiModelPath = (model: string) => {
  const collection = model.startsWith("tunedModels/") ? "tunedModels" : "models";
  const modelId = model.replace(/^(?:models|tunedModels)\//, "");
  return `${collection}/${encodeURIComponent(modelId)}`;
};

export const resolveDevProxyEnv = (
  env: Record<string, string>,
  envDir: string,
  mode: string,
): DevProxyEnv => {
  const recovered = loadLooseEnvBindings(envDir, mode);
  const resolved = {
    ...recovered,
    ...env,
  };
  const geminiModel = resolved.GEMINI_MODEL?.trim();
  if (resolved.GEMINI_API_KEY && !geminiModel) {
    throw new Error("GEMINI_MODEL is required when AI is enabled");
  }

  return {
    argoEndpoint:
      resolved.ARGO_ENDPOINT || resolved.VITE_ARGO_ENDPOINT || "http://127.0.0.1:2746",
    argoNamespace: resolved.ARGO_NAMESPACE || resolved.VITE_ARGO_NAMESPACE || "default",
    argoToken: resolved.ARGO_TOKEN || resolved.VITE_ARGO_TOKEN || "",
    geminiApiKey: resolved.GEMINI_API_KEY || "",
    geminiModel,
  };
};
