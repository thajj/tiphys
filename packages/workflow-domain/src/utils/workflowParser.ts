import * as yaml from 'js-yaml';
import { AppNode, AppEdge, WorkflowMetadata, WorkflowSpec, FlowNodeData, NodeType } from '../types';
import { getLayoutedElements } from './dagLayout';
import { MarkerType } from 'reactflow';

const getId = () => `imported-${Math.random().toString(36).substr(2, 9)}`;

export const parseYamlToWorkflow = (yamlString: string): { nodes: AppNode[], edges: AppEdge[], metadata: WorkflowMetadata, spec: WorkflowSpec } | null => {
    try {
        const obj: any = yaml.load(yamlString);
        if (!obj) {
            throw new Error("Invalid Argo Workflow YAML. Object is empty.");
        }
        if (obj.kind && !['Workflow', 'WorkflowTemplate', 'ClusterWorkflowTemplate'].includes(obj.kind)) {
            throw new Error(`Invalid Argo Workflow YAML. Unsupported kind: ${obj.kind}`);
        }

        const metadata: WorkflowMetadata = {
            name: obj.metadata?.generateName?.replace(/-$/, '') || obj.metadata?.name || 'imported-workflow',
            namespace: obj.metadata?.namespace || 'default',
            labels: obj.metadata?.labels,
            annotations: obj.metadata?.annotations
        };

        const spec: WorkflowSpec = {
            entrypoint: obj.spec?.entrypoint || 'main',
            templates: [], // We won't store raw templates, we parse them into nodes
            activeDeadlineSeconds: obj.spec?.activeDeadlineSeconds,
            serviceAccountName: obj.spec?.serviceAccountName,
            securityContext: obj.spec?.securityContext,
            parallelism: obj.spec?.parallelism,
            podGC: obj.spec?.podGC,
            ttlStrategy: obj.spec?.ttlStrategy,
            imagePullSecrets: obj.spec?.imagePullSecrets,
            volumes: obj.spec?.volumes,
            arguments: obj.spec?.arguments,
            artifactRepositoryRef: obj.spec?.artifactRepositoryRef
        };

        const templates = obj.spec?.templates || [];
        let entrypointName = spec.entrypoint;
        let entrypointTemplate = templates.find((t: any) => t.name === entrypointName);

        if (!entrypointTemplate) {
            if (templates.length > 0) {
                console.warn(`Entrypoint '${entrypointName}' not found. Falling back to first template '${templates[0].name}'.`);
                entrypointTemplate = templates[0];
                entrypointName = templates[0].name;
                spec.entrypoint = entrypointName;
            } else {
                throw new Error(`No templates found or entrypoint '${entrypointName}' missing.`);
            }
        }

        let nodes: AppNode[] = [];
        let edges: AppEdge[] = [];

        // Helper to find a template definition
        const findTemplate = (name: string) => templates.find((t: any) => t.name === name);

        // Helper to convert a template to node data
        const templateToNodeData = (tmpl: any, taskLabel: string): FlowNodeData => {
             // Multiple tasks can call the same template with different arguments.
             // Each node needs its own copy before those arguments are merged.
             tmpl = structuredClone(tmpl);
             let type: NodeType = 'container';
             let data: Partial<FlowNodeData> = {
                 label: taskLabel || tmpl.name,
                 status: 'Pending',
                 inputs: tmpl.inputs,
                 outputs: tmpl.outputs,
                 retryStrategy: tmpl.retryStrategy,
                 activeDeadlineSeconds: tmpl.activeDeadlineSeconds,
                 daemon: tmpl.daemon,
                 // Map Node Selector object back to array
                 nodeSelector: tmpl.nodeSelector ? Object.entries(tmpl.nodeSelector).map(([k, v]) => ({ name: k, value: String(v) })) : undefined
             };

             if (tmpl.container) {
                 type = 'container';
                 data.container = {
                     ...tmpl.container,
                     image: tmpl.container.image,
                     command: Array.isArray(tmpl.container.command) ? tmpl.container.command.join(' ') : tmpl.container.command,
                     importedCommand: Array.isArray(tmpl.container.command)
                         ? { text: tmpl.container.command.join(' '), argv: tmpl.container.command }
                         : undefined,
                     env: tmpl.container.env,
                     resources: tmpl.container.resources,
                     volumeMounts: tmpl.container.volumeMounts
                 };
             } else if (tmpl.script) {
                 type = 'script';
                 data.script = {
                     ...tmpl.script,
                     useImageEntrypoint: tmpl.script.command === undefined,
                     image: tmpl.script.image,
                     source: tmpl.script.source
                 };
             } else if (tmpl.resource) {
                 type = 'resource';
                 data.resource = tmpl.resource;
             } else if (tmpl.suspend) {
                 type = 'suspend';
                 data.suspend = tmpl.suspend;
             } else if (tmpl.http) {
                 type = 'http';
                 data.http = tmpl.http;
             } else if (tmpl.containerSet) {
                 type = 'container-set';
                 data.containerSet = tmpl.containerSet;
             }

             return { ...data, type } as FlowNodeData;
        };

        // PARSING STRATEGY:
        // 1. If Entrypoint is a DAG, parse tasks.
        // 2. If Entrypoint is Steps, convert steps to nodes (simplified).
        // 3. If Entrypoint is a simple template, create 1 node.

        if (entrypointTemplate.dag) {
            const tasks = entrypointTemplate.dag.tasks || [];
            const taskNodeMap = new Map<string, string>(); // taskName -> nodeId

            tasks.forEach((task: any) => {
                task = structuredClone(task);
                const nodeId = getId();
                taskNodeMap.set(task.name, nodeId);

                let nodeData: any;

                if (task.templateRef) {
                    nodeData = {
                        label: task.name,
                        type: 'sub-workflow',
                        subWorkflow: {
                            workflowName: task.templateRef.name,
                            workflowId: ''
                        },
                        status: 'Pending'
                    };
                    if (task.arguments) {
                        nodeData.inputs = {
                            parameters: task.arguments.parameters || [],
                            artifacts: task.arguments.artifacts || []
                        };
                    }
                } else {
                    // If task references a template, look it up.
                    // If it has inline template, use it.
                    let effectiveTemplate = task.template ? findTemplate(task.template) : task;
                    if (!effectiveTemplate && task.template) {
                         // If template not found, maybe it's in another file, but we fallback to a placeholder
                         effectiveTemplate = { name: task.template, container: { image: 'unknown', command: 'template not found' } };
                    }
                    nodeData = templateToNodeData(effectiveTemplate, task.name);

                    // Merge task arguments into nodeData inputs
                    if (task.arguments) {
                        if (!nodeData.inputs) nodeData.inputs = {};

                        if (task.arguments.parameters) {
                            if (!nodeData.inputs.parameters) nodeData.inputs.parameters = [];
                            task.arguments.parameters.forEach((argParam: any) => {
                                const existingParam = nodeData.inputs.parameters.find((p: any) => p.name === argParam.name);
                                if (existingParam) {
                                    if (argParam.value !== undefined) {
                                        existingParam.value = argParam.value;
                                        delete existingParam.valueFrom;
                                    }
                                    if (argParam.valueFrom !== undefined) {
                                        existingParam.valueFrom = argParam.valueFrom;
                                        delete existingParam.value;
                                    }
                                } else {
                                    nodeData.inputs.parameters.push(argParam);
                                }
                            });
                        }

                        if (task.arguments.artifacts) {
                            if (!nodeData.inputs.artifacts) nodeData.inputs.artifacts = [];
                            task.arguments.artifacts.forEach((argArt: any) => {
                                const existingArt = nodeData.inputs.artifacts.find((a: any) => a.name === argArt.name);
                                if (existingArt) {
                                    if (argArt.from !== undefined) existingArt.from = argArt.from;
                                } else {
                                    nodeData.inputs.artifacts.push(argArt);
                                }
                            });
                        }
                    }
                }

                // Handle Flow Control
                if (task.when) {
                    nodeData.flowControl = { ...nodeData.flowControl, when: task.when };
                }
                if (task.withItems) {
                     nodeData.flowControl = { ...nodeData.flowControl, loop: { type: 'withItems', value: JSON.stringify(task.withItems) } };
                } else if (task.withParam) {
                     nodeData.flowControl = { ...nodeData.flowControl, loop: { type: 'withParam', value: task.withParam } };
                }

                nodes.push({
                    id: nodeId,
                    type: 'custom',
                    position: { x: 0, y: 0 }, // Will be auto-layouted
                    data: nodeData
                });
            });

            // Build Edges
            tasks.forEach((task: any) => {
                const targetId = taskNodeMap.get(task.name);
                const dependencies = new Set<string>();

                // 1. Explicit 'dependencies' array
                if (task.dependencies && Array.isArray(task.dependencies)) {
                    task.dependencies.forEach((d: string) => dependencies.add(d));
                }

                // 2. 'depends' string expression (e.g., "A && B")
                if (task.depends && typeof task.depends === 'string') {
                    // Extract potential task names by splitting on non-identifier chars
                    // This is a heuristic but works for standard alphanumeric task names
                    const tokens = task.depends.split(/[^a-zA-Z0-9_-]+/);
                    tokens.forEach((t: string) => {
                        if (t && taskNodeMap.has(t)) {
                            dependencies.add(t);
                        }
                    });
                }

                dependencies.forEach((depName) => {
                    const sourceId = taskNodeMap.get(depName);
                    if (sourceId && targetId) {
                        edges.push({
                            id: `e-${sourceId}-${targetId}`,
                            source: sourceId,
                            target: targetId,
                            animated: true,
                            markerEnd: { type: MarkerType.ArrowClosed },
                            type: 'smoothstep'
                        });
                    }
                });
            });

        } else if (entrypointTemplate.steps) {
             // Basic Steps support: Convert list of lists to sequential/parallel nodes
             let prevStepIds: string[] = [];

             entrypointTemplate.steps.forEach((stepGroup: any[], groupIdx: number) => {
                 const currentStepIds: string[] = [];

                 stepGroup.forEach((step: any, stepIdx: number) => {
                     step = structuredClone(step);
                     const nodeId = getId();
                     currentStepIds.push(nodeId);

                     let effectiveTemplate = step.template ? findTemplate(step.template) : step;
                     if (!effectiveTemplate && step.template) effectiveTemplate = { name: step.template, container: { image: 'unknown' } };

                     const nodeData = templateToNodeData(effectiveTemplate, step.name || `step-${groupIdx}-${stepIdx}`);

                     // Merge step arguments into nodeData inputs
                     if (step.arguments) {
                         if (!nodeData.inputs) nodeData.inputs = {};

                         if (step.arguments.parameters) {
                             if (!nodeData.inputs.parameters) nodeData.inputs.parameters = [];
                             step.arguments.parameters.forEach((argParam: any) => {
                                 const existingParam = nodeData.inputs.parameters.find((p: any) => p.name === argParam.name);
                                 if (existingParam) {
                                     if (argParam.value !== undefined) {
                                         existingParam.value = argParam.value;
                                         delete existingParam.valueFrom;
                                     }
                                     if (argParam.valueFrom !== undefined) {
                                         existingParam.valueFrom = argParam.valueFrom;
                                         delete existingParam.value;
                                     }
                                 } else {
                                     nodeData.inputs.parameters.push(argParam);
                                 }
                             });
                         }

                         if (step.arguments.artifacts) {
                             if (!nodeData.inputs.artifacts) nodeData.inputs.artifacts = [];
                             step.arguments.artifacts.forEach((argArt: any) => {
                                 const existingArt = nodeData.inputs.artifacts.find((a: any) => a.name === argArt.name);
                                 if (existingArt) {
                                     if (argArt.from !== undefined) existingArt.from = argArt.from;
                                 } else {
                                     nodeData.inputs.artifacts.push(argArt);
                                 }
                             });
                         }
                     }

                     // Handle Flow Control for steps
                     if (step.when) {
                         nodeData.flowControl = { ...nodeData.flowControl, when: step.when };
                     }
                     if (step.withItems) {
                          nodeData.flowControl = { ...nodeData.flowControl, loop: { type: 'withItems', value: JSON.stringify(step.withItems) } };
                     } else if (step.withParam) {
                          nodeData.flowControl = { ...nodeData.flowControl, loop: { type: 'withParam', value: step.withParam } };
                     }

                     nodes.push({
                        id: nodeId,
                        type: 'custom',
                        position: { x: 0, y: 0 },
                        data: nodeData
                    });

                    // Connect to all nodes in previous group
                    prevStepIds.forEach(prevId => {
                         edges.push({
                            id: `e-${prevId}-${nodeId}`,
                            source: prevId,
                            target: nodeId,
                            animated: true,
                            markerEnd: { type: MarkerType.ArrowClosed },
                            type: 'smoothstep'
                        });
                    });
                 });
                 prevStepIds = currentStepIds;
             });

        } else {
            // Single Node Workflow
            const nodeId = getId();
            nodes.push({
                id: nodeId,
                type: 'custom',
                position: { x: 0, y: 0 },
                data: templateToNodeData(entrypointTemplate, entrypointTemplate.name)
            });
        }

        // Apply Layout
        const layouted = getLayoutedElements(nodes, edges);

        return {
            nodes: layouted.nodes,
            edges: layouted.edges,
            metadata,
            spec
        };

    } catch (e) {
        console.error("Failed to parse YAML", e);
        return null;
    }
};
