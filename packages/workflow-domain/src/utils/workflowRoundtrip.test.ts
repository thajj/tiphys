import { describe, expect, it } from "vitest";
import { parseYamlToWorkflow } from "./workflowParser";
import { generateWorkflowObject } from "./workflowGenerator";

const importWorkflow = (spec: Record<string, unknown>) => {
  const parsed = parseYamlToWorkflow(JSON.stringify({
    apiVersion: "argoproj.io/v1alpha1", kind: "Workflow",
    metadata: { name: "imported", namespace: "workflows" }, spec,
  }));
  expect(parsed).not.toBeNull();
  return parsed!;
};
const generate = (parsed: NonNullable<ReturnType<typeof parseYamlToWorkflow>>) =>
  generateWorkflowObject(parsed.nodes, parsed.edges, parsed.metadata, parsed.spec);

describe("ordinary Argo import roundtrips", () => {
  it("preserves literal container argv, arguments, and security settings", () => {
    const securityContext = { runAsNonRoot: true, allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ["ALL"] } };
    const podSecurityContext = { runAsUser: 1000, fsGroup: 1000, seccompProfile: { type: "RuntimeDefault" } };
    const container = {
      image: "busybox:1.37.0", command: ["/bin/echo", "a single argument", "$HOME; literal"],
      args: ["hello world", "--flag=value"], securityContext, workingDir: "/work",
      env: [{ name: "MODE", value: "test" }], resources: { limits: { memory: "64Mi" } },
    };
    const parsed = importWorkflow({ entrypoint: "main", securityContext: podSecurityContext, templates: [{ name: "main", container }] });
    const generated = generate(parsed);
    expect(generated.spec.securityContext).toEqual(podSecurityContext);
    const output = generated.spec.templates.find((template: any) => template.container).container;
    expect(output).toEqual(container);
    expect(output).not.toHaveProperty("importedCommand");
    expect(new Set(generated.spec.templates.map((template: any) => template.name)).size).toBe(generated.spec.templates.length);
    expect(generated.spec.templates.find((template: any) => template.name === generated.spec.entrypoint).dag.tasks[0].template).toBe("main");
  });

  it("keeps an image's default entrypoint when only args were imported", () => {
    const parsed = importWorkflow({ entrypoint: "hello", templates: [{ name: "hello", container: { image: "example/entrypoint", args: ["--message", "hello world"] } }] });
    const output = generate(parsed).spec.templates.find((template: any) => template.container).container;
    expect(output.command).toBeUndefined();
    expect(output.args).toEqual(["--message", "hello world"]);
  });

  it("uses shell command semantics after the imported command is edited", () => {
    const parsed = importWorkflow({ entrypoint: "main", templates: [{ name: "main", container: { image: "busybox", command: ["echo", "hello world"] } }] });
    parsed.nodes[0].data.container!.command = "echo edited && echo again";
    expect(generate(parsed).spec.templates.find((template: any) => template.container).container.command).toEqual(["sh", "-c", "echo edited && echo again"]);
  });

  it("preserves a shell script's interpreter, arguments, and container settings", () => {
    const script = {
      image: "bash:5", command: ["bash", "-eux"], args: ["arg with spaces"], source: "echo hello\necho done",
      securityContext: { runAsNonRoot: true, runAsUser: 1000, capabilities: { drop: ["ALL"] } },
      volumeMounts: [{ name: "scratch", mountPath: "/scratch" }],
    };
    const parsed = importWorkflow({ entrypoint: "shell", templates: [{ name: "shell", script }] });
    expect(generate(parsed).spec.templates.find((template: any) => template.script).script).toEqual(script);
  });

  it("preserves an omitted imported script command instead of replacing the image entrypoint", () => {
    const script = { image: "node:22-alpine", source: "console.log('hello from the image entrypoint')" };
    const parsed = importWorkflow({ entrypoint: "javascript", templates: [{ name: "javascript", script }] });
    const output = generate(parsed).spec.templates.find((template: any) => template.script).script;
    expect(JSON.parse(JSON.stringify(output))).toEqual(script);
    expect(output).not.toHaveProperty("useImageEntrypoint");
    parsed.nodes[0].data.script!.command = ["node", "--no-warnings"];
    expect(generate(parsed).spec.templates.find((template: any) => template.script).script.command).toEqual(["node", "--no-warnings"]);
  });

  it("retains Python as the default for editor-created scripts", () => {
    const output = generateWorkflowObject([
      { id: "script", type: "custom", position: { x: 0, y: 0 }, data: { label: "Script", type: "script", status: "Pending", script: { image: "python:3.13-alpine", source: "print('hello')" } } },
    ], [], { name: "created", namespace: "workflows" }, { entrypoint: "main", templates: [] });
    expect(output.spec.templates.find((template: any) => template.script).script.command).toEqual(["python"]);
  });

  it.each(["dag", "steps"] as const)("isolates arguments for repeated template calls in %s workflows", kind => {
    const tasks = [
      { name: "first", template: "echo", arguments: { parameters: [{ name: "message", value: "first value" }], artifacts: [{ name: "input", from: "first-artifact" }] } },
      { name: "second", template: "echo", arguments: { parameters: [{ name: "message", valueFrom: { expression: "workflow.name" } }], artifacts: [{ name: "input", from: "second-artifact" }] } },
      { name: "default", template: "echo" },
    ];
    const parsed = importWorkflow({
      entrypoint: "main", templates: [
        { name: "main", ...(kind === "dag" ? { dag: { tasks } } : { steps: tasks.map(task => [task]) }) },
        { name: "echo", inputs: { parameters: [{ name: "message", value: "original" }], artifacts: [{ name: "input", path: "/input" }] }, container: { image: "busybox", args: ["{{inputs.parameters.message}}"] } },
      ],
    });
    const inputs = parsed.nodes.map(node => node.data.inputs!);
    expect(inputs[0].parameters).toEqual([{ name: "message", value: "first value" }]);
    expect(inputs[1].parameters).toEqual([{ name: "message", valueFrom: { expression: "workflow.name" } }]);
    expect(inputs[2].parameters).toEqual([{ name: "message", value: "original" }]);
    expect(inputs[0].artifacts![0].from).toBe("first-artifact");
    expect(inputs[1].artifacts![0].from).toBe("second-artifact");
    expect(inputs[2].artifacts![0].from).toBeUndefined();
    inputs[0].parameters![0].value = "edited first";
    expect(inputs[2].parameters![0].value).toBe("original");
    const generatedTasks = generate(parsed).spec.templates[0].dag.tasks;
    expect(generatedTasks[0].arguments.parameters[0].value).toBe("edited first");
    expect(generatedTasks[1].arguments.parameters[0]).toEqual({ name: "message", valueFrom: { expression: "workflow.name" } });
    expect(generatedTasks[2].arguments.parameters[0].value).toBe("original");
  });
});
