import { describe, expect, it } from "vitest";
import { geminiModelPath, normalizeAuthHeaderValue, recoverLooseEnvBindings, resolveDevProxyEnv } from "./devProxyEnv";

describe("workflow-builder dev env helpers", () => {
  it("does not duplicate bearer prefixes", () => {
    expect(normalizeAuthHeaderValue("Bearer demo-token")).toBe("Bearer demo-token");
    expect(normalizeAuthHeaderValue("demo-token")).toBe("Bearer demo-token");
  });

  it("recovers copied export-style env lines", () => {
    const recovered = recoverLooseEnvBindings(
      [
        "export ARGO_TOKEN='Bearer demo-token'",
        "export ARGO_NAMESPACE=argo",
        "ARGO_ENDPOINT=http://127.0.0.1:2746",
      ].join("\n"),
    );

    expect(recovered.ARGO_TOKEN).toBe("Bearer demo-token");
    expect(recovered.ARGO_NAMESPACE).toBe("argo");
    expect(recovered.ARGO_ENDPOINT).toBe("http://127.0.0.1:2746");
  });

  it("ignores legacy VITE_ credential and configuration prefixes", () => {
    const env = resolveDevProxyEnv(
      {
        VITE_ARGO_ENDPOINT: "http://vite.example:2746",
        VITE_ARGO_NAMESPACE: "vite-namespace",
        VITE_ARGO_TOKEN: "vite-token",
      },
      "/__no_local_environment__",
      "test",
    );

    expect(env.argoEndpoint).toBe("http://127.0.0.1:2746");
    expect(env.argoNamespace).toBe("default");
    expect(env.argoToken).toBe("");
  });

  it("requires an explicit model when development AI is enabled", () => {
    for (const GEMINI_MODEL of ["", "  "]) {
      expect(() => resolveDevProxyEnv({ GEMINI_API_KEY: "fixture-key", GEMINI_MODEL }, "/__no_local_environment__", "test"))
        .toThrow("GEMINI_MODEL is required when AI is enabled");
    }
    expect(() => resolveDevProxyEnv({ GEMINI_API_KEY: "fixture-key" }, "/__no_local_environment__", "test"))
      .toThrow("GEMINI_MODEL is required when AI is enabled");
    expect(resolveDevProxyEnv({}, "/__no_local_environment__", "test")).toMatchObject({ geminiApiKey: "", geminiModel: undefined });
  });

  it.each([
    ["gemini-example", "models/gemini-example"],
    ["models/gemini-example", "models/gemini-example"],
    ["tunedModels/example-model", "tunedModels/example-model"],
  ])("uses the configured model %s without changing its resource prefix", (model, resource) => {
    const env = resolveDevProxyEnv({ GEMINI_API_KEY: "fixture-key", GEMINI_MODEL: ` ${model} ` }, "/__no_local_environment__", "test");
    expect(env.geminiModel).toBe(model);
    expect(geminiModelPath(env.geminiModel!)).toBe(resource);
  });
});
