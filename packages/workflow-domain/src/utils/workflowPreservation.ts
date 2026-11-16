import * as jsYaml from 'js-yaml';
import { isAlias, isMap, isNode, isScalar, isSeq, parseDocument, visit, type Document, type Pair, type YAMLMap } from 'yaml';
import type { AppEdge, AppNode, WorkflowEditorSource, WorkflowMetadata, WorkflowSpec } from '../types';
import { getNodeSlug } from './workflowGenerator';
import { MANIFEST_YAML_SCHEMA } from './workflowParser';
import { mergeLineEdits } from './lineMerge';

/**
 * Regenerates an imported manifest by patching visual edits into a copy of the
 * original document instead of rebuilding it from the editor's partial model.
 *
 * The editor only models a subset of Argo. Rendering the as-imported projection
 * and the current projection through the plain generator and diffing the two
 * isolates exactly what the user changed; everything else in the original
 * document is left untouched.
 */

export class WorkflowEditRequiresYamlError extends Error {
    constructor(message: string) {
        super(`${message} Make this change in the YAML editor instead.`);
        this.name = 'WorkflowEditRequiresYamlError';
    }
}

type FreshGenerator = (nodes: AppNode[], edges: AppEdge[], metadata: WorkflowMetadata, spec: WorkflowSpec) => any;
type Path = (string | number)[];

const isPlainObject = (value: unknown): value is Record<string, any> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/** Deep equality where a missing property and an `undefined` one are the same (drafts pass through JSON). */
export const sameValue = (a: unknown, b: unknown): boolean => {
    if (a === b) return true;
    if (Array.isArray(a) || Array.isArray(b)) {
        return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => sameValue(item, b[index]));
    }
    if (isPlainObject(a) && isPlainObject(b)) {
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        for (const key of keys) {
            if (!sameValue(a[key], b[key])) return false;
        }
        return true;
    }
    return false;
};

const clone = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

const isNamedList = (value: unknown): value is Record<string, any>[] =>
    Array.isArray(value) &&
    value.every(item => isPlainObject(item) && typeof item.name === 'string') &&
    new Set(value.map(item => item.name)).size === value.length;

/**
 * Which fields a visual control owns. Owned fields may be removed when the editor's
 * data no longer has them; any other field is only ever set or changed, never removed,
 * so a form or AI edit that rebuilds an object from supported fields loses nothing.
 * `alternatives` lists mutually exclusive keys: choosing one removes the others.
 */
type Shape = 'any' | { fields?: Record<string, Shape>; item?: Shape; alternatives?: string[] };
const ANY: Shape = 'any';
const UNOWNED: Shape = {};

const VALUE_FROM: Shape = {
    fields: { path: ANY, parameter: ANY },
    alternatives: ['path', 'parameter', 'expression', 'jsonPath', 'jqFilter', 'event', 'supplied', 'configMapKeyRef'],
};
const NAME_VALUE: Shape = { fields: { name: ANY, value: ANY, valueFrom: VALUE_FROM }, alternatives: ['value', 'valueFrom'] };
const ENV_VAR: Shape = { fields: { name: ANY, value: ANY }, alternatives: ['value', 'valueFrom'] };
const ARTIFACT: Shape = {
    fields: {
        name: ANY, path: ANY, from: ANY, type: ANY, archive: ANY,
        s3: { fields: { bucket: ANY, key: ANY, endpoint: ANY } },
        gcs: { fields: { bucket: ANY, key: ANY } },
    },
    alternatives: ['from', 'fromExpression', 's3', 'gcs', 'git', 'http', 'artifactory', 'hdfs', 'oss', 'raw', 'azure', 'huggingFace'],
};
const CONTAINER_FIELDS: Record<string, Shape> = {
    name: ANY, image: ANY, command: ANY,
    env: { item: ENV_VAR },
    volumeMounts: { item: { fields: { name: ANY, mountPath: ANY } } },
    resources: { fields: { limits: { fields: { cpu: ANY, memory: ANY } }, requests: { fields: { cpu: ANY, memory: ANY } } } },
};
const ARGUMENTS: Shape = { fields: { parameters: { item: NAME_VALUE }, artifacts: { item: ARTIFACT } } };

export const TASK_SHAPE: Shape = {
    fields: {
        name: ANY, template: ANY, dependencies: ANY, when: ANY, withItems: ANY, withParam: ANY,
        templateRef: { fields: { name: ANY, template: ANY } },
        arguments: ARGUMENTS,
    },
    alternatives: ['withItems', 'withParam', 'withSequence'],
};
export const TEMPLATE_SHAPE: Shape = {
    fields: {
        name: ANY, activeDeadlineSeconds: ANY, daemon: ANY, nodeSelector: ANY,
        inputs: { fields: { parameters: { item: { fields: { name: ANY } } }, artifacts: { item: ARTIFACT } } },
        outputs: {
            fields: {
                parameters: { item: { fields: { name: ANY, valueFrom: VALUE_FROM }, alternatives: ['value', 'valueFrom'] } },
                artifacts: { item: ARTIFACT },
            },
        },
        retryStrategy: { fields: { limit: ANY, retryPolicy: ANY, backoff: { fields: { duration: ANY, factor: ANY, maxDuration: ANY } } } },
        container: { fields: CONTAINER_FIELDS },
        script: { fields: { ...CONTAINER_FIELDS, source: ANY } },
        resource: { fields: { action: ANY, manifest: ANY } },
        suspend: { fields: { duration: ANY } },
        http: { fields: { url: ANY, method: ANY, body: ANY, headers: { item: NAME_VALUE } } },
        containerSet: { fields: { containers: { item: { fields: CONTAINER_FIELDS } } } },
    },
};
const SPEC_SHAPE: Shape = {
    fields: {
        serviceAccountName: ANY, securityContext: ANY, activeDeadlineSeconds: ANY, parallelism: ANY,
        imagePullSecrets: ANY, volumes: ANY, artifactRepositoryRef: ANY,
        podGC: { fields: { strategy: ANY, deleteDelayDuration: ANY } },
        ttlStrategy: { fields: { secondsAfterCompletion: ANY, secondsAfterSuccess: ANY, secondsAfterFailure: ANY } },
        arguments: ARGUMENTS,
    },
};
const METADATA_SHAPE: Shape = { fields: { name: ANY, generateName: ANY, namespace: ANY, labels: ANY, annotations: ANY } };
const TEMPLATE_DEFAULTS_SHAPE: Shape = { fields: { parameters: { item: NAME_VALUE } } };

/** The shape of `key` within `shape`, or undefined when that field is not owned. */
const fieldShape = (shape: Shape, key: string): Shape | undefined => (shape === ANY ? ANY : shape.fields?.[key]);
const itemShape = (shape: Shape): Shape => (shape === ANY ? ANY : shape.item ?? UNOWNED);

/** Removes what `base` contributed under an owned field, keeping anything the editor does not own. */
const removeOwned = (target: any, base: any, shape: Shape): any => {
    if (shape === ANY || !isPlainObject(target) || !isPlainObject(base)) return undefined;
    const remaining = applyChange(target, base, {}, shape);
    return isPlainObject(remaining) && Object.keys(remaining).length > 0 ? remaining : undefined;
};

/**
 * Applies the change from `base` to `current` onto `target`, leaving every part
 * of `target` that did not change between `base` and `current` as it was.
 * Returns the patched value; `undefined` means the value should be removed.
 */
export const applyChange = (target: any, base: any, current: any, shape: Shape = ANY): any => {
    if (sameValue(base, current)) return target;
    if (current === undefined) return removeOwned(target, base, shape);

    // When the original lacks the value, write only what changed (e.g. the one edited
    // argument) rather than everything the editor's projection happens to contain.
    const absent = target === undefined;

    if (isPlainObject(current) && (base === undefined || isPlainObject(base)) && (absent || isPlainObject(target))) {
        const before = base ?? {};
        const result: Record<string, any> = absent ? {} : target;
        for (const key of new Set([...Object.keys(before), ...Object.keys(current)])) {
            if (sameValue(before[key], current[key])) continue;
            const owned = fieldShape(shape, key);
            if (current[key] === undefined && owned === undefined) continue;
            const next = applyChange(result[key], before[key], current[key], owned ?? UNOWNED);
            if (next === undefined) delete result[key];
            else result[key] = next;
        }
        // Choosing one of several mutually exclusive fields replaces the others, including
        // ones the editor merely carried over unchanged alongside the new choice.
        if (shape !== ANY && shape.alternatives) {
            const chosen = shape.alternatives.filter(key => current[key] !== undefined && !sameValue(before[key], current[key]));
            if (chosen.length) {
                for (const key of shape.alternatives) {
                    if (!chosen.includes(key) && (current[key] === undefined || sameValue(before[key], current[key]))) delete result[key];
                }
            }
        }
        return absent && Object.keys(result).length === 0 ? undefined : result;
    }

    if (isNamedList(current) && (base === undefined || isNamedList(base)) && (absent || isNamedList(target))) {
        const before = base ?? [];
        const currentNames = new Set(current.map(item => item.name));
        const result = (absent ? [] : target).filter(
            (item: Record<string, any>) => currentNames.has(item.name) || !before.some(entry => entry.name === item.name),
        );
        for (const item of current) {
            const baseItem = before.find(entry => entry.name === item.name);
            const index = result.findIndex((entry: Record<string, any>) => entry.name === item.name);
            if (index !== -1) result[index] = applyChange(result[index], baseItem ?? { name: item.name }, item, itemShape(shape));
            else if (!baseItem || !sameValue(baseItem, item)) result.push(clone(item));
        }
        return absent && result.length === 0 ? undefined : result;
    }

    return clone(current);
};

const getAt = (root: any, path: Path) => path.reduce((value, key) => value?.[key], root);

/** Renders one node in isolation so its task and template can be compared. */
const renderNode = (fresh: FreshGenerator, node: AppNode, metadata: WorkflowMetadata, spec: WorkflowSpec) => {
    const output = fresh([node], [], metadata, { ...spec, editorSource: undefined });
    const [entry, template] = output.spec.templates;
    return { task: entry.dag.tasks[0], template };
};

/**
 * Restores internal import markers that an edit (for example an AI rewrite) dropped
 * while leaving the command untouched, so argv boundaries and image entrypoints survive.
 */
const withImportProvenance = (node: AppNode, importedNode: AppNode): AppNode => {
    const container = node.data.container;
    const importedCommand = importedNode.data.container?.importedCommand;
    const script = node.data.script;
    const restoreArgv = container && !container.importedCommand && importedCommand && container.command === importedCommand.text;
    const restoreEntrypoint = script && script.useImageEntrypoint === undefined && importedNode.data.script?.useImageEntrypoint && script.command === undefined;
    if (!restoreArgv && !restoreEntrypoint) return node;
    return {
        ...node,
        data: {
            ...node.data,
            ...(restoreArgv ? { container: { ...container, importedCommand } } : {}),
            ...(restoreEntrypoint ? { script: { ...script, useImageEntrypoint: true } } : {}),
        },
    };
};

/** Maps generator metadata onto the naming field the original document uses. */
const alignMetadata = (generated: any, originalMetadata: any) => {
    const metadata = { ...generated };
    if (originalMetadata && originalMetadata.generateName === undefined) {
        metadata.name = String(metadata.generateName).replace(/-$/, '');
        delete metadata.generateName;
    }
    return metadata;
};

const specSettings = (generatedSpec: any) => {
    const { templates, entrypoint, ...settings } = generatedSpec;
    return settings;
};

const dependencyIds = (nodeId: string, edges: AppEdge[]) =>
    [...new Set(edges.filter(edge => edge.target === nodeId).map(edge => edge.source))].sort();

const uniqueName = (preferred: string, taken: Set<string>) => {
    let name = preferred;
    for (let suffix = 2; taken.has(name); suffix++) name = `${preferred}-${suffix}`;
    taken.add(name);
    return name;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether the DAG template (with only `tasks` left in it) still points at task `name`. */
const isTaskReferenced = (dagTemplate: any, tasks: any[], name: string) => {
    const reference = new RegExp(`(^|[^A-Za-z0-9_-])${escapeRegExp(name)}([^A-Za-z0-9_-]|$)`);
    const remainingTemplate = { ...dagTemplate, dag: { ...dagTemplate.dag, tasks } };
    return (
        new RegExp(`tasks\\s*(\\.\\s*${escapeRegExp(name)}(?![A-Za-z0-9_-])|\\[\\s*['"]${escapeRegExp(name)}['"]\\s*\\])`).test(JSON.stringify(remainingTemplate)) ||
        tasks.some(task =>
            (Array.isArray(task.dependencies) && task.dependencies.includes(name)) ||
            (typeof task.depends === 'string' && reference.test(task.depends)))
    );
};

/** How many places in the document call template `name` (tasks, steps, hooks, exit handlers). */
const countTemplateCallers = (value: any, name: string): number => {
    if (Array.isArray(value)) return value.reduce((count, item) => count + countTemplateCallers(item, name), 0);
    if (!isPlainObject(value)) return 0;
    let count = (value.template === name ? 1 : 0) + (value.onExit === name ? 1 : 0);
    for (const [key, child] of Object.entries(value)) {
        // A templateRef names a template in another WorkflowTemplate.
        if (key !== 'templateRef') count += countTemplateCallers(child, name);
    }
    return count;
};

const applyGraphEdits = (
    document: any,
    source: WorkflowEditorSource,
    nodes: AppNode[],
    edges: AppEdge[],
    metadata: WorkflowMetadata,
    spec: WorkflowSpec,
    fresh: FreshGenerator,
) => {
    const imported = source.imported;
    const currentIds = new Set(nodes.map(node => node.id));
    const addedNodes = nodes.filter(node => !source.nodes[node.id]);
    const removedIds = imported.nodes.map(node => node.id).filter(id => !currentIds.has(id));
    const rewiredIds = nodes
        .filter(node => source.nodes[node.id])
        .filter(node => !sameValue(dependencyIds(node.id, edges), dependencyIds(node.id, imported.edges)))
        .map(node => node.id);

    if (!addedNodes.length && !removedIds.length && !rewiredIds.length) return;
    if (source.entrypointKind !== 'dag') {
        throw new WorkflowEditRequiresYamlError('Adding, removing, or reconnecting steps is only supported for imported DAG workflows.');
    }

    const dagPath = source.nodes[imported.nodes[0]?.id]?.taskPath?.slice(0, -1);
    const tasks: any[] = dagPath ? getAt(document, dagPath) : undefined;
    if (!Array.isArray(tasks)) {
        throw new WorkflowEditRequiresYamlError('The imported DAG could not be located.');
    }

    // Task names: imported nodes keep their original names; added ones get fresh, unique names.
    const taskNames = new Map<string, string>();
    for (const [id, location] of Object.entries(source.nodes)) {
        if (location.taskPath) taskNames.set(id, getAt(document, location.taskPath).name);
    }
    const takenTaskNames = new Set(tasks.map(task => task.name));
    const takenTemplateNames = new Set<string>((document.spec.templates ?? []).map((template: any) => template.name));
    for (const node of addedNodes) taskNames.set(node.id, uniqueName(getNodeSlug(node.data.label), takenTaskNames));
    const dependencyNames = (nodeId: string) => dependencyIds(nodeId, edges).map(id => taskNames.get(id)!);

    for (const id of rewiredIds) {
        const task = getAt(document, source.nodes[id].taskPath!);
        if (task.depends !== undefined) {
            throw new WorkflowEditRequiresYamlError(`"${task.name}" uses a depends expression, so its connections cannot be changed visually.`);
        }
        const names = dependencyNames(id);
        if (names.length) task.dependencies = names;
        else delete task.dependencies;
    }

    const removedTasks = new Set(removedIds.map(id => getAt(document, source.nodes[id].taskPath!)));
    const remainingTasks = tasks.filter(task => !removedTasks.has(task));
    const dagTemplate = getAt(document, dagPath!.slice(0, -2));
    for (const task of removedTasks) {
        if (isTaskReferenced(dagTemplate, remainingTasks, task.name)) {
            throw new WorkflowEditRequiresYamlError(`"${task.name}" is still referenced by other tasks.`);
        }
    }

    for (const node of addedNodes) {
        const { task, template } = renderNode(fresh, node, metadata, spec);
        task.name = taskNames.get(node.id);
        const names = dependencyNames(node.id);
        if (names.length) task.dependencies = names;
        if (template) {
            template.name = uniqueName(template.name, takenTemplateNames);
            task.template = template.name;
            document.spec.templates.push(clone(template));
        }
        remainingTasks.push(clone(task));
    }

    tasks.splice(0, tasks.length, ...remainingTasks);
};

const TEMPLATE_KINDS = new Set(['WorkflowTemplate', 'ClusterWorkflowTemplate']);
const SERVER_MANAGED_METADATA = ['uid', 'resourceVersion', 'generation', 'creationTimestamp', 'managedFields', 'selfLink'];

/** Imported metadata with visual edits, minus what the server manages, for publishing as a template. */
export const preservedTemplateMetadata = (
    nodes: AppNode[],
    edges: AppEdge[],
    metadata: WorkflowMetadata,
    spec: WorkflowSpec,
    fresh: FreshGenerator,
): Record<string, any> => {
    const preserved = { ...generatePreservedDocument(nodes, edges, metadata, spec, fresh).metadata };
    for (const key of [...SERVER_MANAGED_METADATA, 'generateName']) delete preserved[key];
    return preserved;
};

/** Imported templates are submitted as Workflows that keep their whole spec. */
const asRunnableWorkflow = (document: any) => {
    if (!TEMPLATE_KINDS.has(document.kind)) return document;
    const metadata = { ...document.metadata };
    for (const key of [...SERVER_MANAGED_METADATA, 'name']) delete metadata[key];
    metadata.generateName = `${document.metadata?.name ?? 'workflow'}-`;
    return { ...document, kind: 'Workflow', metadata };
};

/** The imported document with visual edits applied, in its original kind. */
const generatePreservedDocument = (
    nodes: AppNode[],
    edges: AppEdge[],
    metadata: WorkflowMetadata,
    spec: WorkflowSpec,
    fresh: FreshGenerator,
): any => {
    const source = spec.editorSource as WorkflowEditorSource;
    const { editorSource: _editorSource, ...currentSpec } = spec;
    const imported = source.imported;
    const document = clone(source.document);

    if (currentSpec.entrypoint !== imported.spec.entrypoint) {
        throw new WorkflowEditRequiresYamlError('The entrypoint of an imported workflow cannot be changed visually.');
    }

    // Workflow-level settings and metadata.
    const baseOutput = fresh(imported.nodes, imported.edges, imported.metadata, imported.spec);
    const currentOutput = fresh(nodes, edges, metadata, currentSpec);
    const patchedMetadata = applyChange(
        document.metadata,
        alignMetadata(baseOutput.metadata, document.metadata),
        alignMetadata(currentOutput.metadata, document.metadata),
        METADATA_SHAPE,
    );
    if (patchedMetadata === undefined) delete document.metadata;
    else document.metadata = patchedMetadata;
    applyChange(document.spec, specSettings(baseOutput.spec), specSettings(currentOutput.spec), SPEC_SHAPE);

    // Node edits. Graph edits run afterwards because they may reorder tasks.
    const importedNodes = new Map(imported.nodes.map(node => [node.id, node]));
    const originalDocument = source.document;

    for (const node of nodes) {
        const importedNode = importedNodes.get(node.id);
        const location = source.nodes[node.id];
        if (!importedNode || !location) continue;

        if (node.data.label !== importedNode.data.label || node.data.type !== importedNode.data.type) {
            throw new WorkflowEditRequiresYamlError(`Imported step "${importedNode.data.label}" cannot be renamed or change type visually.`);
        }

        const base = renderNode(fresh, importedNode, imported.metadata, imported.spec);
        const current = renderNode(fresh, withImportProvenance(node, importedNode), metadata, currentSpec);

        if (!sameValue(base.task, current.task)) {
            if (location.taskPath) {
                applyChange(getAt(document, location.taskPath), base.task, current.task, TASK_SHAPE);
            } else if (location.templatePath && sameValue({ ...base.task, arguments: undefined }, { ...current.task, arguments: undefined })) {
                // A lone entrypoint template has no task: its arguments are the template's input defaults.
                const template = getAt(document, location.templatePath);
                template.inputs = applyChange(
                    template.inputs ?? {},
                    { parameters: base.task.arguments?.parameters },
                    { parameters: current.task.arguments?.parameters },
                    TEMPLATE_DEFAULTS_SHAPE,
                );
            } else {
                throw new WorkflowEditRequiresYamlError(`"${node.data.label}" has no task to update.`);
            }
        }
        if (!sameValue(base.template, current.template)) {
            if (!location.templatePath) {
                throw new WorkflowEditRequiresYamlError(`"${node.data.label}" has no template to update.`);
            }
            const templateName = getAt(originalDocument, location.templatePath).name;
            // Inline templates have no name and belong to their task alone.
            if (typeof templateName === 'string' && countTemplateCallers(originalDocument, templateName) > 1) {
                // Other callers keep the original; this step gets its own edited copy.
                if (!location.taskPath) {
                    throw new WorkflowEditRequiresYamlError(`"${node.data.label}" uses a template shared with other steps.`);
                }
                const task = getAt(document, location.taskPath);
                const fork = applyChange(clone(getAt(originalDocument, location.templatePath)), base.template, current.template, TEMPLATE_SHAPE);
                fork.name = uniqueName(`${templateName}-${task.name}`, new Set(document.spec.templates.map((template: any) => template.name)));
                document.spec.templates.push(fork);
                task.template = fork.name;
            } else {
                applyChange(getAt(document, location.templatePath), base.template, current.template, TEMPLATE_SHAPE);
            }
        }
    }

    applyGraphEdits(document, source, nodes, edges, metadata, currentSpec, fresh);

    return document;
};

/** The manifest to submit: imported templates become Workflows that keep their whole spec. */
export const generatePreservedWorkflowObject = (
    nodes: AppNode[],
    edges: AppEdge[],
    metadata: WorkflowMetadata,
    spec: WorkflowSpec,
    fresh: FreshGenerator,
): any => asRunnableWorkflow(generatePreservedDocument(nodes, edges, metadata, spec, fresh));

const dumpManifest = (value: unknown) => jsYaml.dump(value, { indent: 2, lineWidth: -1, noRefs: true });
const loadManifest = (text: string) => jsYaml.load(text, { schema: MANIFEST_YAML_SCHEMA });

type YamlNode = ReturnType<Document['createNode']>;
const MERGE_KEY = '<<';
// With merge support the `<<` key's value is a symbol; its source text identifies it.
const keyOf = (pair: Pair) =>
    isScalar(pair.key) ? (pair.key.source === MERGE_KEY || pair.key.value === MERGE_KEY ? MERGE_KEY : pair.key.value) : pair.key;
const isPrimitive = (value: unknown) => value === null || ['string', 'number', 'boolean'].includes(typeof value);

/**
 * A standalone copy of `node`, comments included, without anchors or aliases, so
 * editing it cannot affect anything else.
 */
const detach = (yamlDocument: Document, node: any): any => {
    const copy = node.clone();
    copy.anchor = undefined;
    visit(copy, (_key, child) => {
        if (isAlias(child)) return detach(yamlDocument, child.resolve(yamlDocument));
        if (isNode(child)) child.anchor = undefined;
        return undefined;
    });
    return copy;
};

const resolveAlias = (yamlDocument: Document, node: any) => (isAlias(node) ? node.resolve(yamlDocument) : node);

/** Maps merged into `map` through `<<` keys, in precedence order. */
const mergeSources = (yamlDocument: Document, map: YAMLMap): YAMLMap[] =>
    map.items
        .filter(pair => keyOf(pair) === MERGE_KEY)
        .flatMap(pair => {
            const value = resolveAlias(yamlDocument, pair.value);
            return isSeq(value) ? value.items.map(item => resolveAlias(yamlDocument, item)) : [value];
        })
        .filter((source): source is YAMLMap => isMap(source));

const ownPair = (map: YAMLMap, key: unknown) => map.items.find(pair => keyOf(pair) === key && keyOf(pair) !== MERGE_KEY);

/** The value `map` inherits for `key` through merge keys, if any. */
const inheritedValue = (yamlDocument: Document, map: YAMLMap, key: unknown): any => {
    for (const source of mergeSources(yamlDocument, map)) {
        const pair = ownPair(source, key);
        if (pair) return resolveAlias(yamlDocument, pair.value);
        const deeper = inheritedValue(yamlDocument, source, key);
        if (deeper !== undefined) return deeper;
    }
    return undefined;
};

/**
 * The child at `key` as a node owned by `parent` alone: values reached through an alias
 * or inherited through a merge key are copied in place first, so an edit stays local.
 */
const ownChild = (yamlDocument: Document, parent: any, key: string | number): any => {
    if (isSeq(parent)) {
        const item = parent.items[key as number];
        if (isAlias(item)) parent.items[key as number] = detach(yamlDocument, item.resolve(yamlDocument));
        return parent.items[key as number];
    }
    if (!isMap(parent)) return undefined;
    const pair = ownPair(parent, key);
    if (pair) {
        if (isAlias(pair.value)) pair.value = detach(yamlDocument, pair.value.resolve(yamlDocument));
        return pair.value;
    }
    const inherited = inheritedValue(yamlDocument, parent, key);
    if (inherited === undefined) return undefined;
    const copy = detach(yamlDocument, inherited);
    parent.items.push(yamlDocument.createPair(key, copy));
    return copy;
};

const replacementNode = (yamlDocument: Document, previous: any, value: unknown): YamlNode => {
    // Reusing the scalar keeps its comments and quoting style.
    if (isScalar(previous) && isPrimitive(value) && typeof previous.value === typeof value) {
        previous.value = value;
        return previous as YamlNode;
    }
    return yamlDocument.createNode(value);
};

const setChild = (yamlDocument: Document, parent: any, key: string | number, value: unknown) => {
    if (isSeq(parent)) {
        parent.items[key as number] = replacementNode(yamlDocument, parent.items[key as number], value);
        return;
    }
    const pair = ownPair(parent, key);
    if (pair) pair.value = replacementNode(yamlDocument, pair.value, value);
    else parent.items.push(yamlDocument.createPair(key, value));
};

const deleteChild = (yamlDocument: Document, parent: any, key: string | number) => {
    if (isSeq(parent)) {
        parent.items.splice(key as number, 1);
        return;
    }
    parent.items = parent.items.filter((pair: Pair) => pair !== ownPair(parent, key));
    if (inheritedValue(yamlDocument, parent, key) === undefined) return;
    // The key is still inherited: spell out the merge without it.
    const inheritedKeys = new Set<unknown>();
    const collect = (map: YAMLMap) => {
        for (const source of mergeSources(yamlDocument, map)) {
            source.items.forEach(item => keyOf(item) !== MERGE_KEY && inheritedKeys.add(keyOf(item)));
            collect(source);
        }
    };
    collect(parent);
    for (const inheritedKey of inheritedKeys) {
        if (inheritedKey === key || ownPair(parent, inheritedKey)) continue;
        parent.items.push(yamlDocument.createPair(inheritedKey, detach(yamlDocument, inheritedValue(yamlDocument, parent, inheritedKey))));
    }
    parent.items = parent.items.filter((pair: Pair) => keyOf(pair) !== MERGE_KEY);
};

/** Writes the change at `key` of `parent`, recursing so untouched siblings keep their comments. */
const writeChild = (yamlDocument: Document, parent: any, key: string | number, before: any, after: any) => {
    if (sameValue(before, after)) return;
    if (after === undefined) {
        deleteChild(yamlDocument, parent, key);
        return;
    }
    const child = ownChild(yamlDocument, parent, key);
    if (!writeNode(yamlDocument, child, before, after)) setChild(yamlDocument, parent, key, after);
};

/** Patches `node` in place from `before` to `after`; false when it must be replaced instead. */
const writeNode = (yamlDocument: Document, node: any, before: any, after: any): boolean => {
    if (isMap(node) && isPlainObject(before) && isPlainObject(after)) {
        for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
            writeChild(yamlDocument, node, key, before[key], after[key]);
        }
        return true;
    }
    if (!isSeq(node) || !Array.isArray(before) || !Array.isArray(after)) return false;
    if (before.length === after.length) {
        after.forEach((item, index) => writeChild(yamlDocument, node, index, before[index], item));
        return true;
    }
    if (isNamedList(before) && isNamedList(after)) {
        // Removals and appends keep the surrounding items (and their comments) in place.
        const afterNames = after.map(item => item.name);
        const kept = before.filter(item => afterNames.includes(item.name));
        if (sameValue(kept.map(item => item.name), afterNames.slice(0, kept.length))) {
            for (let index = before.length - 1; index >= 0; index--) {
                if (!afterNames.includes(before[index].name)) node.items.splice(index, 1);
            }
            kept.forEach((item, index) => writeChild(yamlDocument, node, index, item, after[index]));
            after.slice(kept.length).forEach(item => node.items.push(yamlDocument.createNode(item)));
            return true;
        }
    }
    return false;
};

/**
 * Applies the visual edits to the imported YAML text so comments, formatting, and
 * anchors survive. The result is re-parsed and must mean exactly the expected
 * manifest; anything else is refused rather than silently reformatted.
 */
const patchYamlText = (text: string, before: any, after: any): string => {
    if (sameValue(before, after)) return text;
    const renderOptions = {
        lineWidth: 0,
        // Match the author's dominant styles for the edited lines; untouched lines are kept verbatim.
        flowCollectionPadding: (text.match(/[[{] [^\s\]}]/g) ?? []).length > (text.match(/[[{][^\s\]}]/g) ?? []).length,
        indentSeq: !/^( *)[^\s#-][^\n]*:[ \t]*\n\1- /m.test(text),
    };
    try {
        const yamlDocument: Document = parseDocument(text, { merge: true });
        if (yamlDocument.errors.length === 0) {
            const baseline = yamlDocument.toString(renderOptions);
            if (!writeNode(yamlDocument, yamlDocument.contents, before, after)) {
                yamlDocument.contents = yamlDocument.createNode(after);
            }
            const edited = yamlDocument.toString(renderOptions);
            // The original text with only the edited lines replaced, styled like the lines
            // they replace when that provably keeps the meaning.
            for (const restyle of [true, false]) {
                const merged = mergeLineEdits(text, baseline, edited, restyle);
                if (sameValue(loadManifest(merged), after)) return merged;
            }
        }
    } catch {
        // Refused below.
    }
    throw new WorkflowEditRequiresYamlError('This change cannot be written into the imported YAML without altering it elsewhere.');
};

/** The YAML view and download: the imported text with visual edits applied. */
export const generatePreservedYaml = (
    nodes: AppNode[],
    edges: AppEdge[],
    metadata: WorkflowMetadata,
    spec: WorkflowSpec,
    fresh: FreshGenerator,
): string => {
    const source = spec.editorSource as WorkflowEditorSource;
    const document = generatePreservedDocument(nodes, edges, metadata, spec, fresh);
    return source.text === undefined ? dumpManifest(document) : patchYamlText(source.text, source.document, document);
};
