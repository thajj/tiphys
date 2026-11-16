import { describe, expect, it } from "vitest";
import * as yaml from "js-yaml";
import { parseYamlToWorkflow } from "./workflowParser";
import { generateWorkflowObject, generateWorkflowTemplateObject, generateYaml } from "./workflowGenerator";
import { WorkflowEditRequiresYamlError } from "./workflowPreservation";
import { MarkerType } from "reactflow";
import type { AppNode } from "../types";

const ADVANCED_WORKFLOW = `
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  name: advanced-pipeline
  namespace: workflows
  labels:
    team: data
  annotations:
    released: 2024-01-01T00:00:00Z
spec:
  entrypoint: main
  onExit: cleanup
  serviceAccountName: runner
  parallelism: 3
  hooks:
    running:
      expression: workflow.status == "Running"
      template: notify
  podMetadata:
    labels:
      app: pipeline
  nodeSelector:
    pool: batch
  tolerations:
    - key: dedicated
      operator: Equal
      value: batch
      effect: NoSchedule
  volumeClaimTemplates:
    - metadata:
        name: work
      spec:
        accessModes: [ReadWriteOnce]
        resources:
          requests:
            storage: 1Gi
  arguments:
    parameters:
      - name: env
        value: prod
        enum: [dev, prod]
  templates:
    - name: main
      parallelism: 2
      dag:
        failFast: false
        tasks:
          - name: extract
            template: extract
            arguments:
              parameters:
                - name: source
                  value: s3://bucket/raw
          - name: transform
            template: transform
            depends: extract.Succeeded
            withSequence:
              count: "3"
            continueOn:
              failed: true
          - name: load
            template: load
            dependencies: [extract]
            hooks:
              exit:
                template: notify
    - name: extract
      metadata:
        annotations:
          sidecar.istio.io/inject: "false"
      inputs:
        parameters:
          - name: source
      outputs:
        parameters:
          - name: rows
            globalName: rows
            valueFrom:
              path: /tmp/rows
      retryStrategy:
        limit: "2"
        retryPolicy: OnError
        expression: lastRetry.status == "Error"
        backoff:
          duration: 5s
          factor: "2"
      timeout: 10m
      podSpecPatch: '{"terminationGracePeriodSeconds": 5}'
      container:
        image: example/extract:1.0
        command: [extract]
        args: ["--source", "{{inputs.parameters.source}}"]
        env:
          - name: TOKEN
            valueFrom:
              secretKeyRef:
                name: creds
                key: token
        resources:
          requests:
            cpu: 100m
      sidecars:
        - name: proxy
          image: envoyproxy/envoy:v1.30
    - name: transform
      synchronization:
        mutex:
          name: transform
      memoize:
        key: "{{workflow.name}}"
        maxAge: 1h
        cache:
          configMap:
            name: memo
      script:
        image: python:3.12
        command: [python]
        source: |
          print("hi")
    - name: load
      initContainers:
        - name: init
          image: busybox
          command: [sh, -c, "true"]
      container:
        image: example/load:1.0
        volumeMounts:
          - name: work
            mountPath: /work
    - name: notify
      container:
        image: curlimages/curl
        args: ["https://example.invalid"]
    - name: cleanup
      steps:
        - - name: notify-exit
            template: notify
`;

const original = () => yaml.load(ADVANCED_WORKFLOW, { schema: yaml.CORE_SCHEMA }) as any;

const importYaml = (source: string) => {
  const parsed = parseYamlToWorkflow(source);
  expect(parsed).not.toBeNull();
  return parsed!;
};

type Imported = ReturnType<typeof importYaml>;

const generate = (parsed: Imported) =>
  generateWorkflowObject(parsed.nodes, parsed.edges, parsed.metadata, parsed.spec);

// Drafts are stored as JSON, which drops undefined properties.
const throughDraftStorage = (parsed: Imported): Imported => JSON.parse(JSON.stringify(parsed));

const nodeNamed = (parsed: Imported, label: string) => {
  const node = parsed.nodes.find(candidate => candidate.data.label === label);
  expect(node).toBeDefined();
  return node!;
};

const templateNamed = (manifest: any, name: string) =>
  manifest.spec.templates.find((template: any) => template.name === name);

const taskNamed = (manifest: any, name: string) =>
  templateNamed(manifest, "main").dag.tasks.find((task: any) => task.name === name);

describe("imported workflow preservation", () => {
  it("regenerates an unedited advanced manifest without losing or simplifying anything", () => {
    expect(generate(importYaml(ADVANCED_WORKFLOW))).toEqual(original());
  });

  it("regenerates the same manifest after draft storage", () => {
    expect(generate(throughDraftStorage(importYaml(ADVANCED_WORKFLOW)))).toEqual(original());
  });

  it("patches visual node edits into the imported task and template, keeping unmodeled fields", () => {
    const parsed = throughDraftStorage(importYaml(ADVANCED_WORKFLOW));
    const extract = nodeNamed(parsed, "extract").data;
    extract.container!.image = "example/extract:2.0";
    extract.container!.env = [...extract.container!.env!, { name: "MODE", value: "full" }];
    extract.inputs!.parameters = [{ name: "source", value: "s3://bucket/curated" }];

    const expected = original();
    templateNamed(expected, "extract").container.image = "example/extract:2.0";
    templateNamed(expected, "extract").container.env.push({ name: "MODE", value: "full" });
    taskNamed(expected, "extract").arguments.parameters[0].value = "s3://bucket/curated";

    expect(generate(parsed)).toEqual(expected);
  });

  it("patches workflow settings and metadata edits in place", () => {
    const parsed = throughDraftStorage(importYaml(ADVANCED_WORKFLOW));
    parsed.spec.parallelism = 5;
    delete parsed.spec.serviceAccountName;
    parsed.metadata.labels = { ...parsed.metadata.labels, tier: "gold" };

    const expected = original();
    expected.spec.parallelism = 5;
    delete expected.spec.serviceAccountName;
    expected.metadata.labels.tier = "gold";

    expect(generate(parsed)).toEqual(expected);
  });
});

const edgeBetween = (source: AppNode, target: AppNode) => ({
  id: `e-${source.id}-${target.id}`, source: source.id, target: target.id,
  type: "smoothstep", animated: true, markerEnd: { type: MarkerType.ArrowClosed },
});

const canvasNode = (id: string, label: string, image: string): AppNode => ({
  id, type: "custom", position: { x: 0, y: 0 },
  data: { label, type: "container", status: "Pending", container: { image } },
});

describe("single-template imports", () => {
  const SINGLE = `
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  generateName: hello-
spec:
  entrypoint: hello
  templates:
    - name: hello
      inputs:
        parameters:
          - name: message
            value: hi
            description: what to say
      container:
        image: busybox
        args: ["{{inputs.parameters.message}}"]
`;

  it("writes parameter edits back into the template defaults", () => {
    const parsed = importYaml(SINGLE);
    const [message] = parsed.nodes[0].data.inputs!.parameters!;
    parsed.nodes[0].data.inputs!.parameters = [{ ...message, value: "hello there" }];
    const expected = yaml.load(SINGLE) as any;
    expected.spec.templates[0].inputs.parameters[0].value = "hello there";
    expect(generate(parsed)).toEqual(expected);
  });
});

describe("edits that cannot be applied safely", () => {
  const expectYamlOnly = (parsed: Imported) =>
    expect(() => generate(parsed)).toThrow(WorkflowEditRequiresYamlError);

  it("rejects renaming an imported node", () => {
    const parsed = importYaml(ADVANCED_WORKFLOW);
    nodeNamed(parsed, "load").data.label = "load-v2";
    expectYamlOnly(parsed);
  });

  it("rejects changing an imported node's type", () => {
    const parsed = importYaml(ADVANCED_WORKFLOW);
    const load = nodeNamed(parsed, "load").data;
    load.type = "script";
    load.script = { image: "python:3.12", source: "print(1)" };
    expectYamlOnly(parsed);
  });

  it("rejects changing the entrypoint", () => {
    const parsed = importYaml(ADVANCED_WORKFLOW);
    parsed.spec.entrypoint = "cleanup";
    expectYamlOnly(parsed);
  });

  it("gives a step its own copy when it edits a template that other tasks also call", () => {
    const source = `
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata: { name: shared }
spec:
  entrypoint: main
  templates:
    - name: main
      dag:
        tasks:
          - { name: a, template: echo }
          - { name: b, template: echo }
    - name: echo
      retryStrategy: { limit: "1" }
      container: { image: busybox }
`;
    const parsed = importYaml(source);
    nodeNamed(parsed, "a").data.container!.image = "alpine";
    const expected = yaml.load(source) as any;
    expected.spec.templates[0].dag.tasks[0].template = "echo-a";
    expected.spec.templates.push({ name: "echo-a", retryStrategy: { limit: "1" }, container: { image: "alpine" } });
    expect(generate(parsed)).toEqual(expected);
    expect(yaml.load(generateYaml(parsed.nodes, parsed.edges, parsed.metadata, parsed.spec))).toEqual(expected);
  });
});

describe("graph edits on imported DAGs", () => {
  it("adds a new node as a task and template without disturbing imported ones", () => {
    const parsed = throughDraftStorage(importYaml(ADVANCED_WORKFLOW));
    const added = canvasNode("new-node", "Publish", "example/publish:1.0");
    parsed.nodes.push(added);
    parsed.edges.push(edgeBetween(nodeNamed(parsed, "load"), added));

    const expected = original();
    templateNamed(expected, "main").dag.tasks.push({ name: "publish", template: "publish", dependencies: ["load"] });
    expected.spec.templates.push({ name: "publish", container: { image: "example/publish:1.0" } });
    expect(generate(parsed)).toEqual(expected);
  });

  it("gives an added node names that do not collide with existing templates", () => {
    const parsed = importYaml(ADVANCED_WORKFLOW);
    parsed.nodes.push(canvasNode("new-node", "notify", "alpine"));
    const generated = generate(parsed);
    const tasks = templateNamed(generated, "main").dag.tasks;
    expect(tasks.at(-1)).toEqual({ name: "notify", template: "notify-2" });
    expect(templateNamed(generated, "notify")).toEqual(templateNamed(original(), "notify"));
    expect(templateNamed(generated, "notify-2")).toEqual({ name: "notify-2", container: { image: "alpine" } });
  });

  it("removes a deleted node's task and keeps its template", () => {
    const parsed = importYaml(ADVANCED_WORKFLOW);
    const load = nodeNamed(parsed, "load");
    parsed.nodes = parsed.nodes.filter(node => node !== load);
    parsed.edges = parsed.edges.filter(edge => edge.target !== load.id && edge.source !== load.id);

    const expected = original();
    const tasks = templateNamed(expected, "main").dag.tasks;
    tasks.splice(tasks.findIndex((task: any) => task.name === "load"), 1);
    expect(generate(parsed)).toEqual(expected);
  });

  it("updates a task's dependencies when its edges change", () => {
    const parsed = importYaml(ADVANCED_WORKFLOW);
    const load = nodeNamed(parsed, "load");
    parsed.edges = parsed.edges.filter(edge => edge.target !== load.id);

    const expected = original();
    delete taskNamed(expected, "load").dependencies;
    expect(generate(parsed)).toEqual(expected);
  });

  it("rejects removing a task that other tasks still reference", () => {
    const parsed = importYaml(ADVANCED_WORKFLOW);
    const extract = nodeNamed(parsed, "extract");
    parsed.nodes = parsed.nodes.filter(node => node !== extract);
    parsed.edges = parsed.edges.filter(edge => edge.source !== extract.id);
    expect(() => generate(parsed)).toThrow(WorkflowEditRequiresYamlError);
  });

  it("rejects rewiring a task that uses a depends expression", () => {
    const parsed = importYaml(ADVANCED_WORKFLOW);
    parsed.edges.push(edgeBetween(nodeNamed(parsed, "load"), nodeNamed(parsed, "transform")));
    expect(() => generate(parsed)).toThrow(WorkflowEditRequiresYamlError);
  });
});

describe("graph edits on imported steps workflows", () => {
  it("rejects adding a node", () => {
    const parsed = importYaml(`
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata: { name: stepped }
spec:
  entrypoint: main
  templates:
    - name: main
      steps:
        - - { name: one, template: echo }
    - name: echo
      container: { image: busybox }
`);
    parsed.nodes.push(canvasNode("new-node", "two", "alpine"));
    expect(() => generate(parsed)).toThrow(WorkflowEditRequiresYamlError);
  });
});

describe("imported WorkflowTemplates", () => {
  const TEMPLATE = ADVANCED_WORKFLOW
    .replace("kind: Workflow", "kind: WorkflowTemplate")
    .replace("  namespace: workflows\n", "  namespace: workflows\n  resourceVersion: \"42\"\n  uid: 1234\n");

  it("submits as a Workflow that keeps the full template spec", () => {
    const generated = generate(importYaml(TEMPLATE));
    const { name: _name, resourceVersion: _resourceVersion, uid: _uid, ...metadata } = (yaml.load(TEMPLATE, { schema: yaml.CORE_SCHEMA }) as any).metadata;
    expect(generated).toEqual({ ...original(), metadata: { ...metadata, generateName: "advanced-pipeline-" } });
  });

  it("publishes as a WorkflowTemplate that keeps the full template spec", () => {
    const parsed = importYaml(TEMPLATE);
    const { yaml: _yaml, ...published } = generateWorkflowTemplateObject(parsed.nodes, parsed.edges, parsed.metadata, parsed.spec);
    const expected = yaml.load(TEMPLATE, { schema: yaml.CORE_SCHEMA }) as any;
    delete expected.metadata.resourceVersion;
    delete expected.metadata.uid;
    expect(published).toEqual(expected);
  });
});

describe("parameter edits on tasks that rely on template defaults", () => {
  it("adds only the edited parameter to the task's arguments", () => {
    const SOURCE = `
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata: { name: defaults }
spec:
  entrypoint: main
  templates:
    - name: main
      dag:
        tasks:
          - { name: greet, template: greet }
    - name: greet
      inputs:
        parameters:
          - { name: greeting, value: hello }
          - { name: target, value: world }
      container: { image: busybox }
`;
    const parsed = importYaml(SOURCE);
    const parameters = parsed.nodes[0].data.inputs!.parameters!;
    parsed.nodes[0].data.inputs!.parameters = parameters.map(parameter =>
      parameter.name === "target" ? { ...parameter, value: "argo" } : parameter);

    const expected = yaml.load(SOURCE) as any;
    expected.spec.templates[0].dag.tasks[0].arguments = { parameters: [{ name: "target", value: "argo" }] };
    expect(generate(parsed)).toEqual(expected);
  });
});

describe("references from outside the canvas", () => {
  it("forks a template that the exit handler also calls instead of changing the handler", () => {
    const source = `
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata: { name: exit-shared }
spec:
  entrypoint: main
  onExit: notify
  templates:
    - name: main
      dag:
        tasks:
          - { name: announce, template: notify }
    - name: notify
      container: { image: curlimages/curl }
`;
    const parsed = importYaml(source);
    nodeNamed(parsed, "announce").data.container!.image = "alpine";
    const expected = yaml.load(source) as any;
    expected.spec.templates[0].dag.tasks[0].template = "notify-announce";
    expected.spec.templates.push({ name: "notify-announce", container: { image: "alpine" } });
    expect(generate(parsed)).toEqual(expected);
  });

  it("rejects removing a task whose outputs the DAG template exports", () => {
    const parsed = importYaml(`
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata: { name: exported-output }
spec:
  entrypoint: main
  templates:
    - name: main
      outputs:
        parameters:
          - name: result
            valueFrom: { parameter: "{{tasks.compute.outputs.parameters.result}}" }
      dag:
        tasks:
          - { name: compute, template: compute }
    - name: compute
      container: { image: busybox }
      outputs:
        parameters:
          - { name: result, valueFrom: { path: /tmp/result } }
`);
    parsed.nodes = [];
    expect(() => generate(parsed)).toThrow(WorkflowEditRequiresYamlError);
  });
});

describe("YAML text preservation", () => {
  const COMMENTED = `# Nightly ETL, owned by the data platform team
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  name: nightly # fixed name on purpose
  namespace: workflows
spec:
  entrypoint: main
  templates:
    - name: main
      dag:
        tasks:
          # extract runs first
          - name: extract
            template: extract
          - name: load
            template: load
            dependencies: [extract]
    - name: extract
      container:
        image: example/extract:1.0
        resources: &small
          requests:
            cpu: 100m # sized for the nightly volume
    - name: load
      container:
        image: example/load:1.0
        resources: *small
`;
  const yamlOf = (parsed: Imported) => generateYaml(parsed.nodes, parsed.edges, parsed.metadata, parsed.spec);
  const semantics = (text: string) => yaml.load(text, { schema: yaml.CORE_SCHEMA });

  it("returns an unedited import's text exactly, including after draft storage", () => {
    expect(yamlOf(importYaml(COMMENTED))).toBe(COMMENTED);
    expect(yamlOf(throughDraftStorage(importYaml(COMMENTED)))).toBe(COMMENTED);
  });

  it("keeps comments and anchors around a visual edit", () => {
    const parsed = throughDraftStorage(importYaml(COMMENTED));
    nodeNamed(parsed, "load").data.container!.image = "example/load:2.0";
    const text = yamlOf(parsed);

    expect(text).toBe(COMMENTED.replace("image: example/load:1.0", "image: example/load:2.0"));
    for (const kept of ["# Nightly ETL, owned by the data platform team", "# fixed name on purpose", "# extract runs first", "&small", "*small", "dependencies: [extract]"]) {
      expect(text).toContain(kept);
    }
  });

  it("keeps compact sequence indentation around a visual edit", () => {
    const compact = `apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  name: compact
spec:
  entrypoint: main
  templates:
  - name: main
    dag:
      tasks:
      - name: build
        template: build
  - name: build
    container:
      image: busybox
      args:
      - --verbose
`;
    const parsed = importYaml(compact);
    parsed.nodes[0].data.container!.image = "alpine";
    expect(yamlOf(parsed)).toBe(compact.replace("image: busybox", "image: alpine"));
  });

  it("does not leak an edit through a shared anchor", () => {
    const parsed = importYaml(COMMENTED);
    nodeNamed(parsed, "load").data.container!.resources = { requests: { cpu: "100m", memory: "1Gi" } };
    const expected = semantics(COMMENTED) as any;
    templateNamed(expected, "load").container.resources = { requests: { cpu: "100m", memory: "1Gi" } };
    const text = yamlOf(parsed);
    expect(semantics(text)).toEqual(expected);
    for (const kept of ["# Nightly ETL, owned by the data platform team", "# fixed name on purpose", "# extract runs first", "resources: &small"]) {
      expect(text).toContain(kept);
    }
    // The edited copy keeps the comment it had through the alias.
    expect(text.match(/cpu: 100m # sized for the nightly volume/g)).toHaveLength(2);
  });

  it("keeps an imported WorkflowTemplate a WorkflowTemplate in the YAML view", () => {
    const source = COMMENTED.replace("kind: Workflow", "kind: WorkflowTemplate");
    expect(yamlOf(importYaml(source))).toBe(source);
  });

  const MERGED = `# shared container defaults
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata: { name: merged }
spec:
  entrypoint: main
  templates:
    - name: main
      dag:
        tasks:
          - { name: a, template: a }
          - { name: b, template: b }
    - name: a
      container: &base
        image: busybox # default image
        env: [{ name: MODE, value: base }]
    - name: b
      container:
        <<: *base
        args: [run]
`;
  const withMerge = (text: string) => yaml.load(text, { schema: yaml.CORE_SCHEMA.extend({ implicit: [yaml.types.merge] }) }) as any;

  it.each([
    ["overrides an inherited value", (container: any) => { container.env = [{ name: "MODE", value: "override" }]; }],
    ["clears an inherited list", (container: any) => { container.env = []; }],
  ] as const)("keeps comments and merge keys when an edit %s", (_label, change) => {
    const parsed = importYaml(MERGED);
    change(nodeNamed(parsed, "b").data.container);
    const expected = withMerge(MERGED);
    change(templateNamed(expected, "b").container);
    const text = yamlOf(parsed);
    expect(withMerge(text)).toEqual(expected);
    for (const kept of ["# shared container defaults", "# default image", "container: &base", "<<: *base"]) {
      expect(text).toContain(kept);
    }
  });

  it("changes only the edited lines of a file with mixed flow styles", () => {
    const parsed = importYaml(MERGED);
    nodeNamed(parsed, "b").data.container!.image = "alpine";
    // The override keeps the comment the inherited value had, like an in-place edit would.
    expect(yamlOf(parsed)).toBe(MERGED.replace("        args: [run]\n", "        args: [run]\n        image: alpine # default image\n"));
  });

  it("removes an inherited key without touching the anchored original or comments", () => {
    const source = MERGED.replace("image: busybox # default image", "image: busybox # default image\n        command: [echo]");
    const parsed = importYaml(source);
    nodeNamed(parsed, "b").data.container!.command = "";
    const expected = withMerge(source);
    delete templateNamed(expected, "b").container.command;
    const text = yamlOf(parsed);
    expect(withMerge(text)).toEqual(expected);
    for (const kept of ["# shared container defaults", "# default image", "container: &base", "command: [echo]"]) {
      expect(text).toContain(kept);
    }
  });

  it("applies edits correctly under merge keys", () => {
    const source = `apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata: { name: merged }
spec:
  entrypoint: main
  templates:
    - name: main
      dag:
        tasks:
          - { name: a, template: a }
          - { name: b, template: b }
    - name: a
      container: &base
        image: busybox
        env: [{ name: MODE, value: base }]
    - name: b
      container:
        <<: *base
        args: [run]
`;
    const parsed = importYaml(source);
    nodeNamed(parsed, "b").data.container!.image = "alpine";
    const expected = yaml.load(source, { schema: yaml.CORE_SCHEMA.extend({ implicit: [yaml.types.merge] }) }) as any;
    templateNamed(expected, "b").container.image = "alpine";
    expect(yaml.load(yamlOf(parsed), { schema: yaml.CORE_SCHEMA.extend({ implicit: [yaml.types.merge] }) })).toEqual(expected);
  });
});


const ALL_KINDS_SOURCE = `apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  generateName: all-kinds-
  namespace: workflows
spec:
  entrypoint: main
  arguments:
    parameters:
      - name: items
        value: '["a", "b"]'
  templates:
    - name: main
      dag:
        tasks:
          - name: render
            template: render
            arguments:
              artifacts:
                - name: config
                  s3: { key: config/app.yaml }
          - name: apply
            template: apply
            dependencies: [render]
            when: "{{workflow.parameters.items}} != []"
          - name: wait
            template: wait
            dependencies: [apply]
          - name: notify
            template: notify
            dependencies: [wait]
            withParam: "{{workflow.parameters.items}}"
          - name: build
            template: build
            dependencies: [render]
          - name: select
            template: select
            dependencies: [render]
          - name: nested
            template: nested
            dependencies: [select]
          - name: shared
            templateRef: { name: shared-library, template: publish, clusterScope: true }
            dependencies: [build]
            arguments:
              parameters:
                - { name: channel, value: stable }
    - name: render
      inputs:
        artifacts:
          - name: config
            path: /in/config.yaml
            mode: 0444
      outputs:
        artifacts:
          - name: rendered
            path: /out
            archive: { none: {} }
            s3: { key: "rendered/{{workflow.uid}}" }
      script:
        image: python:3.12
        command: [python]
        source: print("render")
        workingDir: /work
        volumeMounts:
          - { name: work, mountPath: /work, readOnly: true }
    - name: apply
      resource:
        action: apply
        setOwnerReference: true
        successCondition: status.phase == Ready
        manifest: |
          apiVersion: v1
          kind: ConfigMap
          metadata: { name: rendered }
    - name: wait
      suspend: { duration: 10m }
    - name: notify
      http:
        url: https://hooks.example.invalid/notify
        method: POST
        timeoutSeconds: 20
        successCondition: response.statusCode == 202
        headers:
          - name: Authorization
            valueFrom: { secretKeyRef: { name: hooks, key: token } }
    - name: build
      containerSet:
        retryStrategy: { retries: 2 }
        volumeMounts:
          - { name: work, mountPath: /work }
        containers:
          - { name: compile, image: golang:1.23, command: [make] }
          - { name: test, image: golang:1.23, command: [make, test], dependencies: [compile] }
    - name: select
      data:
        source:
          artifactPaths: { s3: { bucket: data, key: inbox } }
        transformation:
          - expression: "filter(data, {# endsWith 'csv'})"
    - name: nested
      steps:
        - - name: inner
            template: pause
    - name: pause
      suspend: {}
`;

describe("every template kind", () => {
  const ALL_KINDS = ALL_KINDS_SOURCE;

  it("keeps every unmodeled field while one modeled field per kind is edited", () => {
    const parsed = throughDraftStorage(importYaml(ALL_KINDS));
    nodeNamed(parsed, "render").data.script!.source = 'print("render v2")';
    nodeNamed(parsed, "apply").data.resource!.action = "create";
    nodeNamed(parsed, "apply").data.flowControl!.when = "{{workflow.parameters.items}} != '[]'";
    nodeNamed(parsed, "wait").data.suspend!.duration = "30m";
    nodeNamed(parsed, "notify").data.http!.url = "https://hooks.example.invalid/v2";
    nodeNamed(parsed, "build").data.containerSet!.containers[0].image = "golang:1.24";
    nodeNamed(parsed, "shared").data.inputs!.parameters = [{ name: "channel", value: "beta" }];

    const expected = yaml.load(ALL_KINDS, { schema: yaml.CORE_SCHEMA }) as any;
    templateNamed(expected, "render").script.source = 'print("render v2")';
    templateNamed(expected, "apply").resource.action = "create";
    taskNamed(expected, "apply").when = "{{workflow.parameters.items}} != '[]'";
    templateNamed(expected, "wait").suspend.duration = "30m";
    templateNamed(expected, "notify").http.url = "https://hooks.example.invalid/v2";
    templateNamed(expected, "build").containerSet.containers[0].image = "golang:1.24";
    taskNamed(expected, "shared").arguments.parameters[0].value = "beta";

    expect(generate(parsed)).toEqual(expected);
    const text = generateYaml(parsed.nodes, parsed.edges, parsed.metadata, parsed.spec);
    expect(yaml.load(text, { schema: yaml.CORE_SCHEMA })).toEqual(expected);
    // Only the edited lines differ from the imported text.
    const originalLines = new Set(ALL_KINDS.split("\n"));
    expect(text.split("\n").filter(line => !originalLines.has(line))).toEqual([
      "            when: \"{{workflow.parameters.items}} != '[]'\"",
      "                - { name: channel, value: beta }",
      '        source: print("render v2")',
      "        action: create",
      "      suspend: { duration: 30m }",
      "        url: https://hooks.example.invalid/v2",
      "          - { name: compile, image: golang:1.24, command: [make] }",
    ]);
  });
});

describe("fields the editor does not model", () => {
  // Gives every object in the manifest an extra field the editor knows nothing about.
  const withMarkers = (value: any, path = "root"): any => {
    if (Array.isArray(value)) return value.map((item, index) => withMarkers(item, `${path}.${index}`));
    if (value === null || typeof value !== "object") return value;
    const result: any = {};
    for (const [key, child] of Object.entries(value)) result[key] = withMarkers(child, `${path}.${key}`);
    if (!["arguments", "dag", "inputs", "outputs", "metadata"].includes(path.split(".").at(-1)!)) result["x-marker"] = path;
    return result;
  };
  const markersIn = (value: any, found = new Set<string>()): Set<string> => {
    if (Array.isArray(value)) value.forEach(item => markersIn(item, found));
    else if (value && typeof value === "object") {
      if (typeof value["x-marker"] === "string") found.add(value["x-marker"]);
      Object.values(value).forEach(child => markersIn(child, found));
    }
    return found;
  };

  const STEPS_WORKFLOW = `apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  generateName: stepped-
spec:
  entrypoint: main
  onExit: report
  templates:
    - name: main
      parallelism: 2
      steps:
        - - name: fetch
            template: fetch
            arguments:
              parameters:
                - { name: url, value: https://example.invalid/data }
        - - name: left
            template: process
            withSequence: { count: "2" }
          - name: right
            template: transform
            when: "{{steps.fetch.status}} == Succeeded"
            continueOn: { failed: true }
    - name: fetch
      inputs:
        parameters:
          - { name: url }
      container:
        image: curlimages/curl
        args: ["{{inputs.parameters.url}}"]
        env:
          - { name: RETRIES, value: "3" }
    - name: process
      timeout: 5m
      script: { image: python:3.12, command: [python], source: print(1) }
    - name: transform
      podSpecPatch: '{}'
      container: { image: busybox }
    - name: report
      container: { image: busybox }
`;

  const FIXTURES: Record<string, { source: () => string; graphEdits: boolean }> = {
    advanced: { source: () => ADVANCED_WORKFLOW, graphEdits: true },
    allKinds: { source: () => ALL_KINDS_SOURCE, graphEdits: true },
    steps: { source: () => STEPS_WORKFLOW, graphEdits: false },
  };

  type Edit = { name: string; apply: (parsed: Imported) => void; changesGraph?: boolean };
  const editsFor = (parsed: Imported): Edit[] => [
    ...parsed.nodes.map(node => ({
      name: `template setting on ${node.data.label}`,
      apply: (target: Imported) => { nodeNamed(target, node.data.label).data.activeDeadlineSeconds = 99; },
    })),
    ...parsed.nodes.filter(node => !node.data.flowControl?.when).map(node => ({
      name: `task condition on ${node.data.label}`,
      apply: (target: Imported) => { nodeNamed(target, node.data.label).data.flowControl = { ...nodeNamed(target, node.data.label).data.flowControl, when: "true" }; },
    })),
    ...parsed.nodes.filter(node => node.data.inputs?.parameters?.length).map(node => ({
      name: `parameter value on ${node.data.label}`,
      apply: (target: Imported) => {
        const inputs = nodeNamed(target, node.data.label).data.inputs!;
        inputs.parameters = inputs.parameters!.map((parameter, index) => index === 0 ? { ...parameter, value: "edited" } : parameter);
      },
    })),
    ...parsed.nodes.filter(node => node.data.container?.env?.length).map(node => ({
      name: `appended env var on ${node.data.label}`,
      apply: (target: Imported) => {
        const container = nodeNamed(target, node.data.label).data.container!;
        container.env = [...container.env!, { name: "ADDED", value: "1" }];
      },
    })),
    {
      name: "workflow settings",
      apply: target => { target.spec.parallelism = 7; target.metadata.labels = { ...target.metadata.labels, edited: "yes" }; },
    },
    {
      name: "added node",
      changesGraph: true,
      apply: target => {
        const added = canvasNode("added", "Added", "alpine");
        target.nodes.push(added);
        target.edges.push(edgeBetween(target.nodes[0], added));
      },
    },
  ];

  for (const [fixtureName, { source, graphEdits }] of Object.entries(FIXTURES)) {
    const marked = () => yaml.dump(withMarkers(yaml.load(source(), { schema: yaml.CORE_SCHEMA })));
    const allMarkers = markersIn(yaml.load(marked(), { schema: yaml.CORE_SCHEMA }));

    it(`keeps every unmodeled field of the ${fixtureName} fixture when nothing is edited`, () => {
      const parsed = throughDraftStorage(importYaml(marked()));
      expect(markersIn(generate(parsed))).toEqual(allMarkers);
      expect(generateYaml(parsed.nodes, parsed.edges, parsed.metadata, parsed.spec)).toBe(marked());
    });

    for (const edit of editsFor(importYaml(marked())).filter(candidate => graphEdits || !candidate.changesGraph)) {
      it(`keeps every unmodeled field of the ${fixtureName} fixture after a ${edit.name}`, () => {
        const parsed = throughDraftStorage(importYaml(marked()));
        edit.apply(parsed);
        expect(markersIn(generate(parsed))).toEqual(allMarkers);
        const text = generateYaml(parsed.nodes, parsed.edges, parsed.metadata, parsed.spec);
        expect(markersIn(yaml.load(text, { schema: yaml.CORE_SCHEMA }))).toEqual(allMarkers);
      });
    }

    if (graphEdits) it(`keeps every unmodeled field of the ${fixtureName} fixture after removing an unreferenced task`, () => {
      const parsed = throughDraftStorage(importYaml(marked()));
      const referenced = new Set(parsed.edges.map(edge => edge.source));
      const leaf = parsed.nodes.find(node => !referenced.has(node.id))!;
      parsed.nodes = parsed.nodes.filter(node => node !== leaf);
      parsed.edges = parsed.edges.filter(edge => edge.target !== leaf.id);
      const generated = generate(parsed);
      const tasks = templateNamed(generated, "main").dag.tasks;
      expect(tasks.some((task: any) => task.name === leaf.data.label)).toBe(false);
      const originalTasks = (yaml.load(source(), { schema: yaml.CORE_SCHEMA }) as any).spec.templates[0].dag.tasks;
      const removedTask = `root.spec.templates.0.dag.tasks.${originalTasks.findIndex((task: any) => task.name === leaf.data.label)}`;
      const remaining = [...allMarkers].filter(marker => marker !== removedTask && !marker.startsWith(`${removedTask}.`));
      expect(remaining.length).toBeGreaterThan(40);
      expect(markersIn(generated)).toEqual(new Set(remaining));
    });
  }
});

describe("edits that rebuild data with only the supported fields", () => {
  const SOURCE = `apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  name: rebuilt
  finalizers: [example.org/retain]
  ownerReferences:
    - { apiVersion: v1, kind: ConfigMap, name: owner, uid: owner-id }
spec:
  entrypoint: main
  templates:
    - name: main
      dag:
        tasks:
          - name: Build
            template: build
            arguments:
              artifacts:
                - { name: input, fromExpression: "workflow.artifacts.seed", x-custom: true }
          - name: report
            template: report
            dependencies: [Build]
            arguments:
              parameters:
                - name: summary
                  value: "{{=tasks.Build['outputs'].result}}"
    - name: build
      inputs:
        parameters:
          - { name: message, default: hello, description: keep me, enum: [hello, bye] }
        artifacts:
          - { name: input, path: /in }
      outputs:
        parameters:
          - name: result
            globalName: result
            valueFrom: { expression: "'original'", default: fallback }
      retryStrategy:
        limit: 2
        backoff: { duration: 5s, cap: 30s }
      container:
        image: busybox:1.37
        command: [echo, "two words"]
        imagePullPolicy: IfNotPresent
        workingDir: /tmp
        readinessProbe: { exec: { command: ["true"] } }
        resources:
          requests: { cpu: 100m, example.com/device: "1" }
    - name: report
      inputs:
        parameters:
          - { name: summary }
      script:
        image: node:22
        source: console.log(1)
`;
  const load = () => yaml.load(SOURCE, { schema: yaml.CORE_SCHEMA }) as any;
  const build = (manifest: any) => templateNamed(manifest, "build");

  it("keeps unmodeled container fields when a form returns only supported ones", () => {
    const parsed = importYaml(SOURCE);
    const node = nodeNamed(parsed, "Build");
    const { image, command, importedCommand } = node.data.container!;
    node.data.container = { image: "alpine", command, importedCommand, resources: { requests: { cpu: "200m" } } };
    const expected = load();
    build(expected).container.image = "alpine";
    build(expected).container.resources.requests.cpu = "200m";
    expect(image).toBe("busybox:1.37");
    expect(generate(parsed)).toEqual(expected);
  });

  it("keeps unmodeled parameter properties when a parameter is rebuilt as name and value", () => {
    const parsed = importYaml(SOURCE);
    nodeNamed(parsed, "Build").data.inputs!.parameters = [{ name: "message", value: "bye" }];
    const expected = load();
    taskNamed(expected, "Build").arguments.parameters = [{ name: "message", value: "bye" }];
    expect(generate(parsed)).toEqual(expected);
  });

  it("removes only the supported fields of a removed retry backoff", () => {
    const parsed = importYaml(SOURCE);
    const retry = nodeNamed(parsed, "Build").data.retryStrategy!;
    nodeNamed(parsed, "Build").data.retryStrategy = { limit: retry.limit };
    const expected = load();
    build(expected).retryStrategy.backoff = { cap: "30s" };
    expect(generate(parsed)).toEqual(expected);
  });

  it("replaces an artifact expression when a from reference is chosen, keeping unknown fields", () => {
    const parsed = importYaml(SOURCE);
    const artifacts = nodeNamed(parsed, "Build").data.inputs!.artifacts!;
    nodeNamed(parsed, "Build").data.inputs!.artifacts = artifacts.map(artifact => ({ ...artifact, from: "{{workflow.artifacts.input}}" }));
    const expected = load();
    taskNamed(expected, "Build").arguments.artifacts = [{ name: "input", from: "{{workflow.artifacts.input}}", "x-custom": true }];
    expect(generate(parsed)).toEqual(expected);
  });

  it("replaces an output expression with a chosen path, keeping its fallback", () => {
    const parsed = importYaml(SOURCE);
    nodeNamed(parsed, "Build").data.outputs!.parameters = [{ name: "result", valueFrom: { path: "/tmp/new-result" } }];
    const expected = load();
    build(expected).outputs.parameters[0].valueFrom = { path: "/tmp/new-result", default: "fallback" };
    expect(generate(parsed)).toEqual(expected);
  });

  it("replaces a carried-over expression when the panel adds a path to the same valueFrom", () => {
    const parsed = importYaml(SOURCE);
    const outputs = nodeNamed(parsed, "Build").data.outputs!;
    outputs.parameters = outputs.parameters!.map(parameter => ({ ...parameter, valueFrom: { ...parameter.valueFrom, path: "/tmp/new-result" } }));
    const expected = load();
    build(expected).outputs.parameters[0].valueFrom = { path: "/tmp/new-result", default: "fallback" };
    expect(generate(parsed)).toEqual(expected);
  });

  it("keeps argv boundaries and the image entrypoint when an AI edit drops internal markers", () => {
    const parsed = importYaml(SOURCE);
    const build = nodeNamed(parsed, "Build").data;
    build.container = { ...build.container!, importedCommand: undefined };
    const report = nodeNamed(parsed, "report").data;
    report.script = { ...report.script!, useImageEntrypoint: undefined };
    expect(generate(parsed)).toEqual(load());
  });

  it("blocks deleting a task referenced through a bracketed expression", () => {
    for (const reference of ["{{=tasks.Build['outputs'].result}}", "{{=tasks [ 'Build' ] ['outputs'].result}}"]) {
      const parsed = importYaml(SOURCE.replace("{{=tasks.Build['outputs'].result}}", reference));
      const build = nodeNamed(parsed, "Build");
      parsed.nodes = parsed.nodes.filter(node => node !== build);
      parsed.edges = [];
      expect(() => generate(parsed), reference).toThrow(WorkflowEditRequiresYamlError);
    }
  });

  it("keeps metadata such as finalizers and owner references when publishing as a WorkflowTemplate", () => {
    const parsed = importYaml(SOURCE);
    const { yaml: _yaml, ...published } = generateWorkflowTemplateObject(parsed.nodes, parsed.edges, parsed.metadata, parsed.spec);
    expect(published).toEqual({ ...load(), kind: "WorkflowTemplate", metadata: { ...load().metadata, namespace: "default" } });
  });
});

describe("manifests without a local graph", () => {
  it("imports and regenerates a workflowTemplateRef-only workflow unchanged", () => {
    const source = `apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata: { generateName: from-ref- }
spec:
  workflowTemplateRef: { name: shared-etl, clusterScope: true }
  arguments:
    parameters:
      - { name: env, value: prod }
`;
    const parsed = importYaml(source);
    expect(parsed.nodes).toEqual([]);
    expect(generate(parsed)).toEqual(yaml.load(source));
    expect(generateYaml(parsed.nodes, parsed.edges, parsed.metadata, parsed.spec)).toBe(source);
  });

  it("projects an inline task template and patches edits into it", () => {
    const source = `apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata: { name: inline }
spec:
  entrypoint: main
  templates:
    - name: main
      dag:
        tasks:
          - name: hello
            inline:
              podSpecPatch: '{}'
              container: { image: busybox, args: [hi] }
`;
    const parsed = importYaml(source);
    expect(parsed.nodes[0].data.container?.image).toBe("busybox");
    parsed.nodes[0].data.container!.image = "alpine";
    const expected = yaml.load(source) as any;
    expected.spec.templates[0].dag.tasks[0].inline.container.image = "alpine";
    expect(generate(parsed)).toEqual(expected);
  });

  it("does not add a tasks field to an unedited empty DAG", () => {
    const source = `apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata: { name: empty }
spec:
  entrypoint: main
  templates:
    - name: main
      dag: {}
`;
    const parsed = importYaml(source);
    expect(generate(parsed)).toEqual(yaml.load(source));
  });
});
