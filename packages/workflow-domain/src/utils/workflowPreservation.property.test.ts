import { describe, expect, it } from "vitest";
import * as jsYaml from "js-yaml";
import { isMap, isPair, isScalar, isSeq, parseDocument, visit, type Document, type YAMLMap } from "yaml";
import { parseYamlToWorkflow, MANIFEST_YAML_SCHEMA } from "./workflowParser";
import { generateWorkflowObject, generateYaml } from "./workflowGenerator";
import { WorkflowEditRequiresYamlError } from "./workflowPreservation";
import type { AppNode } from "../types";

/**
 * Randomized check of the preservation guarantee: for random manifests (with unknown
 * fields everywhere, anchors, aliases, and merge keys) and random sequences of visual
 * edits, export either refuses explicitly or keeps every field it was not asked to change.
 */

const FIXTURE = `apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  name: random
  namespace: workflows
  labels: { team: data }
spec:
  entrypoint: main
  onExit: report
  parallelism: 2
  arguments:
    parameters:
      - { name: env, value: prod }
  templates:
    - name: main
      dag:
        tasks:
          - name: fetch
            template: fetch
            arguments:
              parameters:
                - { name: url, value: https://example.invalid }
          - name: build
            template: build
            dependencies: [fetch]
          - name: test
            template: test
            depends: build.Succeeded
          - name: publish
            template: publish
            dependencies: [build]
            withParam: "{{workflow.parameters.env}}"
          - name: wait
            template: wait
            dependencies: [publish]
    - name: fetch
      inputs:
        parameters:
          - { name: url, description: source }
      outputs:
        parameters:
          - name: size
            valueFrom: { path: /tmp/size, default: "0" }
      retryStrategy: { limit: 2, backoff: { duration: 5s, cap: 1m } }
      container:
        image: curlimages/curl
        args: ["{{inputs.parameters.url}}"]
        env:
          - { name: RETRIES, value: "3" }
        resources:
          requests: { cpu: 100m, memory: 64Mi }
    - name: build
      container:
        image: golang:1.23
        command: [make, all]
        env:
          - { name: CGO_ENABLED, value: "0" }
        resources:
          requests: { cpu: 500m, memory: 256Mi }
        volumeMounts:
          - { name: work, mountPath: /work }
    - name: test
      script:
        image: python:3.12
        command: [python]
        source: print("ok")
        resources:
          requests: { cpu: 200m, memory: 128Mi }
    - name: publish
      http:
        url: https://hooks.example.invalid
        method: POST
        headers:
          - { name: Content-Type, value: application/json }
    - name: wait
      suspend: { duration: 1m }
    - name: report
      container:
        image: busybox
        resources:
          requests: { cpu: 50m, memory: 16Mi }
`;

/** Deterministic pseudo-random numbers so any failure is reproducible from its seed. */
const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
};
type Random = ReturnType<typeof random>;
const pick = <T,>(rand: Random, items: T[]): T => items[Math.floor(rand() * items.length)];

/** Map nodes under spec.templates, with the key they sit under, for anchors and merges. */
const templateMaps = (document: Document) => {
  const found: { key: string; map: YAMLMap }[] = [];
  const templates = document.getIn(["spec", "templates"], true);
  visit(templates as any, {
    Pair(_key, pair) {
      if (isPair(pair) && isScalar(pair.key) && isMap(pair.value)) found.push({ key: String(pair.key.value), map: pair.value as YAMLMap });
    },
  });
  return found;
};

/** Whether `map` is no longer reachable as itself (already replaced by an alias). */
const isAliasTarget = (document: Document, map: YAMLMap) => {
  let reachable = false;
  visit(document, { Map(_key, node) { if (node === map) { reachable = true; return visit.BREAK; } return undefined; } });
  return !reachable;
};

const containsAnchor = (map: YAMLMap) => {
  let anchored = false;
  visit(map as any, { Node(_key, node) { if ((node as any).anchor !== undefined) { anchored = true; return visit.BREAK; } return undefined; } });
  return anchored || map.anchor !== undefined;
};

/** A random manifest: markers on every map, then a few anchors/aliases and merge keys between same-named blocks. */
const randomManifest = (rand: Random): string => {
  const document = parseDocument(FIXTURE);
  let marker = 0;
  visit(document, {
    Map(_key, map) {
      if (rand() < 0.8) (map as YAMLMap).set(`x-marker-${marker++}`, `m${marker}`);
    },
  });
  const groups = new Map<string, YAMLMap[]>();
  for (const { key, map } of templateMaps(document)) groups.set(key, [...(groups.get(key) ?? []), map]);
  const shared = [...groups.entries()].filter(([, maps]) => maps.length > 1);
  let anchor = 0;
  for (let round = 0; round < 3 && shared.length; round++) {
    const [key, maps] = pick(rand, shared);
    // Maps are in document order: the anchored source must come before its alias.
    const sourceIndex = Math.floor(rand() * (maps.length - 1));
    const source = maps[sourceIndex];
    const target = pick(rand, maps.slice(sourceIndex + 1));
    // Skip blocks already replaced by an alias, and never replace a block other aliases point at.
    if (isAliasTarget(document, target) || isAliasTarget(document, source) || containsAnchor(target)) continue;
    source.anchor ??= `a${anchor++}`;
    // Either merge the source into the target, or make the target an alias of it.
    if (rand() < 0.5) {
      target.items.unshift(document.createPair("<<", document.createAlias(source)) as any);
    } else {
      visit(document, {
        Pair(_k, pair) {
          if (isPair(pair) && pair.value === target && isScalar(pair.key) && String(pair.key.value) === key) {
            pair.value = document.createAlias(source) as any;
            return visit.BREAK;
          }
          return undefined;
        },
      });
    }
  }
  return document.toString();
};

type Parsed = NonNullable<ReturnType<typeof parseYamlToWorkflow>>;

/** Random visual edits of the kinds the editor can make. */
const randomEdit = (rand: Random, parsed: Parsed): { label: string; removedTask?: string } => {
  const node = pick(rand, parsed.nodes);
  const data = node.data;
  const options: (() => { label: string; removedTask?: string })[] = [
    () => { data.activeDeadlineSeconds = 100 + Math.floor(rand() * 100); return { label: `deadline ${data.label}` }; },
    () => { data.flowControl = { ...data.flowControl, when: "true" }; return { label: `when ${data.label}` }; },
    () => { parsed.spec.parallelism = 1 + Math.floor(rand() * 9); return { label: "parallelism" }; },
    () => { parsed.metadata.labels = { ...parsed.metadata.labels, edited: String(Math.floor(rand() * 9)) }; return { label: "label" }; },
  ];
  const image = data.container ?? data.script;
  if (image) {
    options.push(() => { image.image = `example/edited:${Math.floor(rand() * 9)}`; return { label: `image ${data.label}` }; });
    options.push(() => {
      image.resources = { ...image.resources, requests: { ...image.resources?.requests, cpu: `${1 + Math.floor(rand() * 9)}00m` } };
      return { label: `cpu ${data.label}` };
    });
    if (image.env?.length) {
      options.push(() => {
        image.env = image.env!.map((variable, index) => index === 0 ? { ...variable, value: `v${Math.floor(rand() * 9)}` } : variable);
        return { label: `env ${data.label}` };
      });
    }
    options.push(() => { image.env = [...(image.env ?? []), { name: `ADDED_${Math.floor(rand() * 999)}`, value: "1" }]; return { label: `add env ${data.label}` }; });
  }
  if (data.inputs?.parameters?.length) {
    options.push(() => {
      data.inputs!.parameters = data.inputs!.parameters!.map((parameter, index) => index === 0 ? { ...parameter, value: `p${Math.floor(rand() * 9)}` } : parameter);
      return { label: `parameter ${data.label}` };
    });
  }
  const isLeaf = !parsed.edges.some(edge => edge.source === node.id);
  if (isLeaf && parsed.nodes.length > 1) {
    options.push(() => {
      parsed.nodes = parsed.nodes.filter(candidate => candidate !== node);
      parsed.edges = parsed.edges.filter(edge => edge.target !== node.id);
      return { label: `remove ${data.label}`, removedTask: data.label };
    });
  }
  options.push(() => {
    const added: AppNode = { id: `added-${Math.floor(rand() * 1e6)}`, type: "custom", position: { x: 0, y: 0 }, data: { label: `Added ${Math.floor(rand() * 99)}`, type: "container", status: "Pending", container: { image: "alpine" } } };
    parsed.nodes.push(added);
    parsed.edges.push({ id: `e-${node.id}-${added.id}`, source: node.id, target: added.id });
    return { label: `add after ${data.label}` };
  });
  return pick(rand, options)();
};

const markers = (value: unknown, found = new Set<string>()): Set<string> => {
  if (Array.isArray(value)) value.forEach(item => markers(item, found));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith("x-marker-")) found.add(`${key}=${child}`);
      markers(child, found);
    }
  }
  return found;
};

describe("randomized preservation", () => {
  const RUNS = 300;

  it(`keeps every field it was not asked to change across ${RUNS} random manifests and edit sequences`, () => {
    let applied = 0;
    let refused = 0;
    for (let seed = 1; seed <= RUNS; seed++) {
      const rand = random(seed);
      const source = randomManifest(rand);
      const parsed: Parsed = JSON.parse(JSON.stringify(parseYamlToWorkflow(source)));
      expect(parsed, `seed ${seed}`).not.toBeNull();
      const document = jsYaml.load(source, { schema: MANIFEST_YAML_SCHEMA }) as any;

      const edits = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => randomEdit(rand, parsed));
      const removed = new Set(edits.map(edit => edit.removedTask).filter(Boolean));
      const expectedMarkers = markers({
        ...document,
        spec: {
          ...document.spec,
          templates: document.spec.templates.map((template: any) => template.name === "main"
            ? { ...template, dag: { ...template.dag, tasks: template.dag.tasks.filter((task: any) => !removed.has(task.name)) } }
            : template),
        },
      });
      const context = `seed ${seed}: ${edits.map(edit => edit.label).join(", ")}`;

      let generated: any;
      try {
        generated = generateWorkflowObject(parsed.nodes, parsed.edges, parsed.metadata, parsed.spec);
      } catch (error) {
        expect(error, context).toBeInstanceOf(WorkflowEditRequiresYamlError);
        refused++;
        continue;
      }
      applied++;
      expect(markers(generated), context).toEqual(expectedMarkers);

      let text: string | undefined;
      try {
        text = generateYaml(parsed.nodes, parsed.edges, parsed.metadata, parsed.spec);
      } catch (error) {
        expect(error, context).toBeInstanceOf(WorkflowEditRequiresYamlError);
      }
      if (text !== undefined) {
        expect(jsYaml.load(text, { schema: MANIFEST_YAML_SCHEMA }), context).toEqual(generated);
      }
    }
    // The generator must exercise the apply path, not only refusals.
    expect(applied).toBeGreaterThan(RUNS / 2);
    expect(applied + refused).toBe(RUNS);
  });
});
