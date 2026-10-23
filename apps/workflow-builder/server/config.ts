import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDevProxyEnv, type DevProxyEnv } from "../devProxyEnv";

export interface ServerConfig extends DevProxyEnv {
  publicOrigin: string;
  proxySecret: string;
  editorGroups: string[];
  dataDir: string;
  staticDir: string;
  port: number;
  upstreamTimeoutMs: number;
  geminiModel?: string;
}

export function loadServerConfig(env: Record<string, string | undefined>): ServerConfig {
  const required = (key: string) => {
    const value = env[key]?.trim();
    if (!value) throw new Error(`${key} is required`);
    return value;
  };
  const publicUrl = new URL(required("PUBLIC_URL"));
  if (publicUrl.protocol !== "https:" || publicUrl.pathname !== "/" || publicUrl.search || publicUrl.hash || publicUrl.username || publicUrl.password) {
    throw new Error("PUBLIC_URL must be an HTTPS origin without a path or credentials");
  }
  const proxySecret = required("AUTH_PROXY_SECRET");
  if (proxySecret.length < 32) throw new Error("AUTH_PROXY_SECRET must have at least 32 characters");
  const endpoint = new URL(required("ARGO_ENDPOINT"));
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("ARGO_ENDPOINT must be an HTTP(S) URL without credentials, query, or fragment");
  }
  const namespace = required("ARGO_NAMESPACE");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(namespace)) throw new Error("Invalid ARGO_NAMESPACE");
  required("ARGO_TOKEN");
  // Production uses only injected environment variables; never load developer .env files.
  const cleanEnv = Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const resolved = resolveDevProxyEnv(cleanEnv, "/__no_local_environment__", "production");
  const port = Number(env.PORT || "3000");
  const upstreamTimeoutMs = Number(env.UPSTREAM_TIMEOUT_MS || "30000");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid PORT");
  if (!Number.isInteger(upstreamTimeoutMs) || upstreamTimeoutMs < 100 || upstreamTimeoutMs > 120000) throw new Error("Invalid UPSTREAM_TIMEOUT_MS");
  return {
    ...resolved,
    argoEndpoint: endpoint.href.replace(/\/+$/, ""),
    argoNamespace: namespace,
    publicOrigin: publicUrl.origin,
    proxySecret,
    editorGroups: (env.AUTH_EDITOR_GROUPS || "").split(",").map(group => group.trim()).filter(Boolean),
    dataDir: path.resolve(required("DATA_DIR")),
    staticDir: path.resolve(env.STATIC_DIR || fileURLToPath(new URL("../dist", import.meta.url))),
    port,
    upstreamTimeoutMs,
    geminiModel: env.GEMINI_MODEL?.trim(),
  };
}
