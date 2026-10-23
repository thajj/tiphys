import {
    AppNode,
    AppEdge,
    WorkflowMetadata,
    WorkflowSpec,
    FlowNodeData,
    NameValue,
    WorkflowTemplateSummary,
} from '../types';
import * as yaml from 'js-yaml';

/**
 * Generates a node ID slug (e.g. "Step Name" -> "step-name")
 */
export const getNodeSlug = (label: string): string => {
  return label.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'step';
};

/**
 * Converts internal App Nodes/Edges into a full Argo Workflow Object
 */
export const generateWorkflowObject = (
    nodes: AppNode[],
    edges: AppEdge[],
    metadata: WorkflowMetadata,
    specConfig: WorkflowSpec
): any => {

    const templates: any[] = [];
    const dagTasks: any[] = [];

    // 1. Generate Individual Templates for each Node
    nodes.forEach(node => {
        const d = node.data;
        const templateName = getNodeSlug(d.label);

        // 2. Build DAG Task Entry
        const task: any = {
            name: templateName,
        };

        if (d.type === 'sub-workflow' && d.subWorkflow?.workflowName) {
            task.templateRef = {
                name: d.subWorkflow.workflowName,
                template: 'main' // Assuming 'main' is the entrypoint of the sub-workflow
            };
            // Map inputs as arguments
            if (d.inputs?.parameters?.length || d.inputs?.artifacts?.length) {
                task.arguments = {};
                if (d.inputs.parameters?.length) task.arguments.parameters = d.inputs.parameters;
                if (d.inputs.artifacts?.length) task.arguments.artifacts = d.inputs.artifacts;
            }
        } else {
            task.template = templateName;

            const template: any = {
                name: templateName,
            };

            // Inputs
            if (d.inputs?.parameters?.length || d.inputs?.artifacts?.length) {
                template.inputs = {};
                if (d.inputs.parameters?.length) {
                    template.inputs.parameters = d.inputs.parameters.map(p => {
                        const { value, valueFrom, ...rest } = p;
                        // Map value to default in template if needed, but passing as argument is safer for dynamic values
                        return rest;
                    });

                    const paramsWithValue = d.inputs.parameters.filter(p => p.value !== undefined || p.valueFrom !== undefined);
                    if (paramsWithValue.length > 0) {
                        if (!task.arguments) task.arguments = {};
                        if (!task.arguments.parameters) task.arguments.parameters = [];

                        paramsWithValue.forEach(p => {
                            const argParam: any = { name: p.name };
                            if (p.value !== undefined) argParam.value = p.value;
                            if (p.valueFrom !== undefined) argParam.valueFrom = p.valueFrom;
                            task.arguments.parameters.push(argParam);
                        });
                    }
                }
                if (d.inputs.artifacts?.length) {
                    template.inputs.artifacts = d.inputs.artifacts.map(a => {
                        const { from, ...rest } = a;
                        return rest;
                    });

                    // Add 'from' to task arguments
                    const artifactsWithFrom = d.inputs.artifacts.filter(a => a.from);
                    if (artifactsWithFrom.length > 0) {
                        if (!task.arguments) task.arguments = {};
                        if (!task.arguments.artifacts) task.arguments.artifacts = [];

                        artifactsWithFrom.forEach(a => {
                            task.arguments.artifacts.push({
                                name: a.name,
                                from: a.from
                            });
                        });
                    }
                }
            }

            // Outputs
            if (d.outputs?.parameters?.length || d.outputs?.artifacts?.length) {
                template.outputs = {};
                if (d.outputs.parameters?.length) template.outputs.parameters = d.outputs.parameters;
                if (d.outputs.artifacts?.length) template.outputs.artifacts = d.outputs.artifacts;
            }

            // Advanced Template Configs
            if (d.activeDeadlineSeconds) template.activeDeadlineSeconds = d.activeDeadlineSeconds;
            if (d.daemon) template.daemon = true;

            // Map Node Selector Array to Object
            if (d.nodeSelector && d.nodeSelector.length > 0) {
                template.nodeSelector = {};
                d.nodeSelector.forEach(item => {
                    if (item.name) template.nodeSelector[item.name] = item.value || '';
                });
            }

            // Retry Strategy
            if (d.retryStrategy?.limit || d.retryStrategy?.retryPolicy) {
                template.retryStrategy = {};
                if (d.retryStrategy.limit !== undefined) template.retryStrategy.limit = d.retryStrategy.limit;
                if (d.retryStrategy.retryPolicy) template.retryStrategy.retryPolicy = d.retryStrategy.retryPolicy;
                if (d.retryStrategy.backoff?.duration) {
                    template.retryStrategy.backoff = {
                        duration: d.retryStrategy.backoff.duration,
                        factor: d.retryStrategy.backoff.factor,
                        maxDuration: d.retryStrategy.backoff.maxDuration
                    };
                }
            }

            // Node Logic Implementation
            if (d.type === 'container' && d.container) {
                const { command, importedCommand, ...container } = d.container;
                template.container = {
                    ...container,
                    command: importedCommand && command === importedCommand.text
                        ? [...importedCommand.argv]
                        : command ? ['sh', '-c', command] : undefined,
                };
            } else if (d.type === 'script' && d.script) {
                const { useImageEntrypoint, ...script } = d.script;
                template.script = {
                    ...script,
                    command: script.command ?? (useImageEntrypoint ? undefined : ['python']),
                };
            } else if (d.type === 'resource' && d.resource) {
                template.resource = d.resource;
            } else if (d.type === 'suspend' && d.suspend) {
                template.suspend = d.suspend;
            } else if (d.type === 'http' && d.http) {
                template.http = d.http;
            } else if (d.type === 'container-set' && d.containerSet) {
                template.containerSet = d.containerSet;
            }

            templates.push(template);
        }

        // Flow Control: Dependencies
        const dependencies = edges
            .filter(e => e.target === node.id)
            .map(e => {
                const sourceNode = nodes.find(n => n.id === e.source);
                return sourceNode ? getNodeSlug(sourceNode.data.label) : null;
            })
            .filter(Boolean);

        if (dependencies.length > 0) {
            task.dependencies = dependencies;
        }

        // Flow Control: When
        if (d.flowControl?.when) {
            task.when = d.flowControl.when;
        }

        // Flow Control: Loops
        if (d.flowControl?.loop?.value) {
            if (d.flowControl.loop.type === 'withItems') {
                try {
                    // Try to parse as JSON, otherwise treat as string (param ref)
                    task.withItems = JSON.parse(d.flowControl.loop.value);
                } catch {
                    task.withItems = d.flowControl.loop.value;
                }
            } else {
                task.withParam = d.flowControl.loop.value;
            }
        }

        dagTasks.push(task);
    });

    // 3. Create Main Entrypoint Template (DAG)
    let entrypoint = specConfig.entrypoint || 'main';
    // A simple imported template often has the same name as its entrypoint.
    // The wrapper DAG must have a distinct name from every generated template.
    const templateNames = new Set(templates.map(template => template.name));
    const preferredEntrypoint = entrypoint;
    for (let suffix = 1; templateNames.has(entrypoint); suffix++) {
        entrypoint = `${preferredEntrypoint}-dag${suffix === 1 ? '' : `-${suffix}`}`;
    }
    const mainTemplate = {
        name: entrypoint,
        dag: {
            tasks: dagTasks
        }
    };

    // 4. Final Assembly
    const spec: any = {
        entrypoint: entrypoint,
        templates: [mainTemplate, ...templates]
    };

    // Map Workflow Spec Configs
    if (specConfig.serviceAccountName) spec.serviceAccountName = specConfig.serviceAccountName;
    if (specConfig.securityContext) spec.securityContext = specConfig.securityContext;
    if (specConfig.activeDeadlineSeconds) spec.activeDeadlineSeconds = specConfig.activeDeadlineSeconds;
    if (specConfig.parallelism) spec.parallelism = specConfig.parallelism;

    if (specConfig.podGC?.strategy) {
        spec.podGC = { strategy: specConfig.podGC.strategy };
        if (specConfig.podGC.deleteDelayDuration) spec.podGC.deleteDelayDuration = specConfig.podGC.deleteDelayDuration;
    }

    if (specConfig.ttlStrategy) {
        spec.ttlStrategy = {};
        if (specConfig.ttlStrategy.secondsAfterCompletion !== undefined) spec.ttlStrategy.secondsAfterCompletion = specConfig.ttlStrategy.secondsAfterCompletion;
        if (specConfig.ttlStrategy.secondsAfterSuccess !== undefined) spec.ttlStrategy.secondsAfterSuccess = specConfig.ttlStrategy.secondsAfterSuccess;
        if (specConfig.ttlStrategy.secondsAfterFailure !== undefined) spec.ttlStrategy.secondsAfterFailure = specConfig.ttlStrategy.secondsAfterFailure;
    }

    if (specConfig.imagePullSecrets && specConfig.imagePullSecrets.length > 0) {
        spec.imagePullSecrets = specConfig.imagePullSecrets;
    }

    if (specConfig.volumes && specConfig.volumes.length > 0) {
        spec.volumes = specConfig.volumes;
    }

    if (specConfig.arguments) {
        spec.arguments = specConfig.arguments;
    }

    if (specConfig.artifactRepositoryRef) {
        spec.artifactRepositoryRef = specConfig.artifactRepositoryRef;
    }

    const metadataObj: any = {
        generateName: `${metadata.name}-`,
        namespace: metadata.namespace,
    };
    if (metadata.labels && Object.keys(metadata.labels).length > 0) {
        metadataObj.labels = metadata.labels;
    }
    if (metadata.annotations && Object.keys(metadata.annotations).length > 0) {
        metadataObj.annotations = metadata.annotations;
    }

    return {
        apiVersion: 'argoproj.io/v1alpha1',
        kind: 'Workflow',
        metadata: metadataObj,
        spec: spec
    };
};

export const generateYaml = (nodes: AppNode[], edges: AppEdge[], metadata: WorkflowMetadata, spec: WorkflowSpec): string => {
    const obj = generateWorkflowObject(nodes, edges, metadata, spec);
    return yaml.dump(obj, { indent: 2, lineWidth: -1, noRefs: true });
};

export const generateWorkflowTemplateObject = (
    nodes: AppNode[],
    edges: AppEdge[],
    metadata: WorkflowMetadata,
    spec: WorkflowSpec
): WorkflowTemplateSummary => {
    const workflow = generateWorkflowObject(nodes, edges, metadata, spec);
    const template = {
        ...workflow,
        kind: 'WorkflowTemplate',
        metadata: {
            name: metadata.name,
            namespace: metadata.namespace,
            ...(metadata.labels && Object.keys(metadata.labels).length > 0 ? { labels: metadata.labels } : {}),
            ...(metadata.annotations && Object.keys(metadata.annotations).length > 0 ? { annotations: metadata.annotations } : {}),
        },
    } satisfies WorkflowTemplateSummary;

    return {
        ...template,
        yaml: yaml.dump(template, { indent: 2, lineWidth: -1, noRefs: true }),
    };
};

export const createWorkflowFromTemplate = (
    template: Pick<WorkflowTemplateSummary, 'metadata' | 'spec'>,
    namespace: string,
    argumentsOverride?: WorkflowSpec['arguments'],
) => ({
    apiVersion: 'argoproj.io/v1alpha1',
    kind: 'Workflow',
    metadata: {
        generateName: `${template.metadata.name}-`,
        namespace,
        ...(template.metadata.labels && Object.keys(template.metadata.labels).length > 0
            ? { labels: template.metadata.labels }
            : {}),
        ...(template.metadata.annotations && Object.keys(template.metadata.annotations).length > 0
            ? { annotations: template.metadata.annotations }
            : {}),
    },
    spec: {
        workflowTemplateRef: {
            name: template.metadata.name,
        },
        ...(argumentsOverride || template.spec.arguments
            ? {
                arguments: argumentsOverride || template.spec.arguments,
            }
            : {}),
    },
});
