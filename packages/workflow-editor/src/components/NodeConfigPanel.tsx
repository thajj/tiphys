import React, { useEffect, useState, useRef } from 'react';
import type { AppNode, FlowNodeData, NameValue, ContainerConfig, Artifact } from '@tiphys/workflow-domain';
import { Settings, Trash2, Plus, X, Cpu, HardDrive, Split, Repeat, ArrowRightCircle, Layers, Code, FolderOpen, Package, Cloud, Zap, Calendar, Sparkles, Loader2, ChevronDown, ChevronUp, Maximize2, RefreshCw } from 'lucide-react';
import { geminiService } from '../services/geminiService';
import Editor from '@monaco-editor/react';
import { getWorkflowRuntime } from '../platform/runtime';
import { draftMirrorStorage } from '../platform/storage';
import { usePlatformTheme } from '@tiphys/ui-platform';
import { ConfirmationDialog } from './ConfirmationDialog';
import { YamlDocumentEditor } from './YamlDocumentEditor';
import { yamlModelPaths } from '../yaml/monacoYaml';

interface NodeConfigPanelProps {
  selectedNode: AppNode | null;
  onChange: (id: string, data: any) => void;
  onDelete: (id: string) => void;
}

const NodeConfigPanel: React.FC<NodeConfigPanelProps> = ({ selectedNode, onChange, onDelete }) => {
  const { theme } = usePlatformTheme();
  const [formData, setFormData] = useState<FlowNodeData | null>(null);
  const [activeTab, setActiveTab] = useState<'props' | 'logic' | 'io' | 'adv'>('props');
  const [activeContainerIdx, setActiveContainerIdx] = useState<number>(0);
  const [showAiEdit, setShowAiEdit] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const aiRequestVersion = useRef(0);
  const [fullScreenEditor, setFullScreenEditor] = useState<{
    isOpen: boolean;
    title: string;
    value: string;
    language: string;
    path: string[];
  }>({ isOpen: false, title: '', value: '', language: '', path: [] });
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);

  const prevNodeIdRef = useRef<string | null>(null);
  const prevNodeDataRef = useRef<string | null>(null);
  const canUseAI = getWorkflowRuntime().shell.featureFlags.aiAssistant && getWorkflowRuntime().shell.permissions.canUseAI;
  const editorTheme = theme === 'dark' ? 'vs-dark' : 'vs-light';

  useEffect(() => () => {
    // A captured callback must not mutate another workflow after this inspector
    // unmounts, even when the next workflow reuses the same node IDs.
    aiRequestVersion.current += 1;
  }, []);

  useEffect(() => {
    if (selectedNode) {
        const nextData = JSON.stringify(selectedNode.data);
        if (selectedNode.id !== prevNodeIdRef.current) {
            aiRequestVersion.current += 1;
            setAiLoading(false);
            setAiError(null);
            setFormData(JSON.parse(JSON.stringify(selectedNode.data)));
            prevNodeIdRef.current = selectedNode.id;
            setShowAiEdit(false); // Reset AI Edit on node switch
            setAiPrompt('');
            setActiveContainerIdx(0);
        } else if (nextData !== prevNodeDataRef.current) {
            aiRequestVersion.current += 1;
            setAiLoading(false);
            if (aiLoading) setAiError('AI edit was discarded because the node changed. Review your changes and try again.');
            // Parent echoes of local edits should not replace the current form
            // object. Actual external updates (undo, YAML, etc.) must resync it.
            setFormData(current => JSON.stringify(current) === nextData ? current : JSON.parse(nextData));
        }
        prevNodeDataRef.current = nextData;
    } else {
        aiRequestVersion.current += 1;
        setAiLoading(false);
        setAiError(null);
        setFormData(null);
        prevNodeIdRef.current = null;
        prevNodeDataRef.current = null;
    }
  }, [selectedNode]);

  const updateField = (path: string[], value: any) => {
    if (!formData || !selectedNode) return;
    aiRequestVersion.current += 1;
    if (aiLoading) setAiError('AI edit was discarded because the node changed. Review your changes and try again.');
    setAiLoading(false);
    const newData = JSON.parse(JSON.stringify(formData));

    let current = newData;
    for (let i = 0; i < path.length - 1; i++) {
        if (!current[path[i]]) current[path[i]] = {};
        current = current[path[i]];
    }
    current[path[path.length - 1]] = value;

    setFormData(newData);
    onChange(selectedNode.id, newData);
  };

  const handleAiEdit = async () => {
    if (!aiPrompt.trim() || !formData || !selectedNode || !canUseAI || aiLoading) return;
    const requestVersion = ++aiRequestVersion.current;
    setAiLoading(true);
    setAiError(null);
    try {
        const updatedData = await geminiService.editNode(formData, aiPrompt);
        if (requestVersion !== aiRequestVersion.current) return;
        setFormData(updatedData);
        onChange(selectedNode.id, updatedData);
        setShowAiEdit(false);
        setAiPrompt('');
    } catch (e) {
        if (requestVersion === aiRequestVersion.current) {
            setAiError(e instanceof Error ? e.message : 'AI editing failed. Please try again.');
        }
    } finally {
        if (requestVersion === aiRequestVersion.current) setAiLoading(false);
    }
  };

  const handleNameValueChange = (
      arrayPath: string[],
      index: number,
      field: 'name' | 'value',
      val: string
  ) => {
    if (!formData) return;
    let list: any[] = arrayPath.reduce((obj, key) => obj && obj[key], formData as any) || [];
    const newList = [...list];
    if (!newList[index]) newList[index] = { name: '', value: '' };
    newList[index] = { ...newList[index], [field]: val };
    updateField(arrayPath, newList);
  };

  const addNameValue = (arrayPath: string[]) => {
      let list: any[] = arrayPath.reduce((obj, key) => obj && obj[key], formData as any) || [];
      updateField(arrayPath, [...list, { name: '', value: '' }]);
  };

  const removeNameValue = (arrayPath: string[], index: number) => {
      let list: any[] = arrayPath.reduce((obj, key) => obj && obj[key], formData as any) || [];
      updateField(arrayPath, list.filter((_, i) => i !== index));
  };

  // --- Artifact Helpers ---
  const handleArtifactChange = (
      type: 'inputs' | 'outputs',
      index: number,
      field: keyof Artifact | string,
      val: any
  ) => {
    if (!formData) return;
    const artifacts = formData[type]?.artifacts || [];
    const newArtifacts = [...artifacts];
    if (!newArtifacts[index]) return;

    if (field.includes('.')) {
        const [parent, child] = field.split('.');
        if (parent === 'gcs') {
             newArtifacts[index] = {
                 ...newArtifacts[index],
                 gcs: { ...(newArtifacts[index].gcs || { bucket: '', key: '' }), [child]: val }
             };
        } else if (parent === 's3') {
             newArtifacts[index] = {
                 ...newArtifacts[index],
                 s3: { ...(newArtifacts[index].s3 || { bucket: '', key: '' }), [child]: val }
             };
        }
    } else {
        newArtifacts[index] = { ...newArtifacts[index], [field]: val };
    }

    updateField([type, 'artifacts'], newArtifacts);
  };

  const addArtifact = (type: 'inputs' | 'outputs') => {
      const artifacts = formData?.[type]?.artifacts || [];
      updateField([type, 'artifacts'], [...artifacts, { name: 'artifact', path: '/tmp/data', type: 'container' }]);
  };

  const removeArtifact = (type: 'inputs' | 'outputs', index: number) => {
      const artifacts = formData?.[type]?.artifacts || [];
      updateField([type, 'artifacts'], artifacts.filter((_, i) => i !== index));
  };

  // --- Volume Mount Helpers ---
  const handleVolumeMountChange = (
      arrayPath: string[],
      index: number,
      field: 'name' | 'mountPath',
      val: string
  ) => {
    if (!formData) return;
    let list: any[] = arrayPath.reduce((obj, key) => obj && obj[key], formData as any) || [];
    const newList = [...list];
    if (!newList[index]) newList[index] = { name: '', mountPath: '' };
    newList[index] = { ...newList[index], [field]: val };
    updateField(arrayPath, newList);
  };

  const addVolumeMount = (arrayPath: string[]) => {
      let list: any[] = arrayPath.reduce((obj, key) => obj && obj[key], formData as any) || [];
      updateField(arrayPath, [...list, { name: '', mountPath: '' }]);
  };

  const removeVolumeMount = (arrayPath: string[], index: number) => {
      let list: any[] = arrayPath.reduce((obj, key) => obj && obj[key], formData as any) || [];
      updateField(arrayPath, list.filter((_, i) => i !== index));
  };

  // --- ContainerSet Helpers ---
  const addContainer = () => {
      const containers = formData?.containerSet?.containers || [];
      updateField(['containerSet', 'containers'], [...containers, { name: `container-${containers.length + 1}`, image: 'alpine', command: '' }]);
      setActiveContainerIdx(containers.length);
  };

  const removeContainer = (idx: number) => {
      const containers = formData?.containerSet?.containers || [];
      if (containers.length <= 1) return; // Prevent deleting last container
      const newContainers = containers.filter((_, i) => i !== idx);
      updateField(['containerSet', 'containers'], newContainers);
      setActiveContainerIdx(Math.max(0, idx - 1));
  };

  const updateContainerField = (idx: number, field: keyof ContainerConfig | string, value: any) => {
      const containers = [...(formData?.containerSet?.containers || [])];

      if (field.includes('.')) {
         // handle nested resource updates like 'resources.requests.cpu'
         const parts = field.split('.');
         let current = containers[idx] as any;
         for(let i=0; i<parts.length-1; i++) {
             if (!current[parts[i]]) current[parts[i]] = {};
             current = current[parts[i]];
         }
         current[parts[parts.length-1]] = value;
      } else {
         containers[idx] = { ...containers[idx], [field]: value };
      }
      updateField(['containerSet', 'containers'], containers);
  };

  if (!selectedNode || !formData) {
    return null; // Don't render anything if no node is selected, cleaner floating UI
  }

  // Helper to get nested safe values
  const getContainer = () => formData.container || { image: '', command: '' };
  const getScript = () => formData.script || { image: 'python:3.9', source: '' };
  const getHttp = () => formData.http || { method: 'GET', url: '' };
  const getResource = () => formData.resource || { action: 'create', manifest: '' };
  const getContainerSet = () => formData.containerSet || { containers: [] };

  // Common Styles
  const inputBaseClass = "w-full rounded-md border border-[rgb(var(--wb-color-border-subtle)/0.38)] bg-[rgb(var(--wb-color-bg-base))] p-2.5 text-sm text-[rgb(var(--wb-color-text-primary))] outline-none transition-colors placeholder:text-[rgb(var(--wb-color-text-muted))] focus-visible:border-[rgb(var(--wb-color-border-subtle)/0.7)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--wb-color-accent-primary)/0.22)] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--wb-color-bg-surface))]";
  const smallInputClass = "rounded-md border border-[rgb(var(--wb-color-border-subtle)/0.38)] bg-[rgb(var(--wb-color-bg-base))] p-2 text-xs text-[rgb(var(--wb-color-text-primary))] outline-none transition-colors placeholder:text-[rgb(var(--wb-color-text-muted))] focus-visible:border-[rgb(var(--wb-color-border-subtle)/0.7)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--wb-color-accent-primary)/0.22)] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--wb-color-bg-surface))]";
  const labelClass = "text-xs font-bold uppercase tracking-wide text-[rgb(var(--wb-color-text-muted))]";
  const sectionCardClass = "rounded-xl border border-[rgb(var(--wb-color-border-subtle)/0.52)] bg-[rgb(var(--wb-color-bg-surface-hover)/0.7)] shadow-[0_10px_22px_rgba(15,23,42,0.05)]";
  const subtleButtonClass = "border border-[rgb(var(--wb-color-border-subtle)/0.52)] bg-[rgb(var(--wb-color-bg-surface)/0.78)] text-[rgb(var(--wb-color-text-secondary))] hover:border-[rgb(var(--wb-color-border-strong)/0.52)] hover:bg-[rgb(var(--wb-color-bg-surface-hover)/0.82)] hover:text-[rgb(var(--wb-color-text-primary))]";
  const accentButtonClass = "border border-[rgb(var(--wb-color-accent-primary)/0.32)] bg-[rgb(var(--wb-color-accent-primary)/0.18)] text-[rgb(var(--wb-color-accent-primary))] hover:bg-[rgb(var(--wb-color-accent-primary)/0.24)]";
  const dividerClass = "border-[rgb(var(--wb-color-border-subtle)/0.38)]";
  const sectionTitleClass = "font-semibold text-[rgb(var(--wb-color-text-primary))]";
  const secondaryTextClass = "text-[rgb(var(--wb-color-text-secondary))]";
  const mutedTextClass = "text-[rgb(var(--wb-color-text-muted))]";
  const inlineActionClass = "text-xs font-semibold text-[rgb(var(--wb-color-accent-primary))] transition-colors hover:text-[rgb(var(--wb-color-accent-primary-hover))]";
  const iconButtonClass = "rounded-lg p-1 text-[rgb(var(--wb-color-text-muted))] transition-colors hover:bg-[rgb(var(--wb-color-bg-surface-hover)/0.82)] hover:text-[rgb(var(--wb-color-accent-primary))]";
  const removeButtonClass = "rounded-md p-1 text-[rgb(var(--wb-color-text-muted))] transition-colors hover:bg-[rgba(239,68,68,0.08)] hover:text-[rgb(var(--wb-color-status-error))]";
  const editorFrameClass = "overflow-hidden rounded-xl border border-[rgb(var(--wb-color-border-subtle)/0.56)] bg-[rgb(var(--wb-color-bg-base)/0.76)]";
  const emptyStateClass = "text-xs italic text-[rgb(var(--wb-color-text-muted))]";
  const checkboxClass = "h-4 w-4 rounded border-[rgb(var(--wb-color-border-subtle))] bg-[rgb(var(--wb-color-bg-base))] text-[rgb(var(--wb-color-accent-primary))] focus:ring-[rgb(var(--wb-color-accent-primary)/0.2)]";

  const renderArtifactForm = (type: 'inputs' | 'outputs') => {
      const artifacts = formData?.[type]?.artifacts || [];
      const title = type === 'inputs' ? 'Input Artifacts' : 'Output Artifacts';

      return (
         <div className="space-y-4">
             <div className={`flex items-center justify-between border-b pb-2 ${dividerClass}`}>
                <label className={`${labelClass} flex items-center gap-2`}>
                   <Package size={14} /> {title}
                </label>
                <button onClick={() => addArtifact(type)} className={`flex items-center gap-1 ${inlineActionClass}`}><Plus size={10}/> Add</button>
             </div>
             {artifacts.map((a: Artifact, idx: number) => (
                <div key={idx} className={`${sectionCardClass} space-y-2 p-3 transition-colors hover:border-[rgb(var(--wb-color-accent-primary)/0.32)]`}>
                     <div className="flex justify-between items-center">
                         <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-bold ${mutedTextClass}`}>ARTIFACT {idx+1}</span>
                            <select
                                value={a.type || 'container'}
                                onChange={(e) => handleArtifactChange(type, idx, 'type', e.target.value)}
                                className={`${smallInputClass} px-1.5 py-0.5 text-[10px]`}
                            >
                                <option value="container">Internal</option>
                                <option value="gcs">GCS</option>
                                <option value="s3">S3</option>
                                <option value="git">Git</option>
                            </select>
                         </div>
                         <button onClick={() => removeArtifact(type, idx)} className={removeButtonClass}><X size={14} /></button>
                     </div>

                     <div className="grid grid-cols-2 gap-2">
                        <input placeholder="Name" value={a.name} onChange={(e) => handleArtifactChange(type, idx, 'name', e.target.value)} className={smallInputClass} />
                        <input placeholder="Mount Path" value={a.path} onChange={(e) => handleArtifactChange(type, idx, 'path', e.target.value)} className={`${smallInputClass} font-mono`} />
                     </div>

                     {/* GCS Config */}
                     {a.type === 'gcs' && (
                        <div className="mt-1 grid grid-cols-1 gap-2 rounded-xl border border-[rgb(var(--wb-color-accent-primary)/0.22)] bg-[rgb(var(--wb-color-accent-primary)/0.08)] p-2">
                             <div className="flex items-center gap-1 text-[10px] font-bold text-[rgb(var(--wb-color-accent-primary))]"><Cloud size={10}/> GCS Configuration</div>
                             <input placeholder="Bucket" value={a.gcs?.bucket || ''} onChange={(e) => handleArtifactChange(type, idx, 'gcs.bucket', e.target.value)} className={smallInputClass} />
                             <input placeholder="Key" value={a.gcs?.key || ''} onChange={(e) => handleArtifactChange(type, idx, 'gcs.key', e.target.value)} className={smallInputClass} />
                        </div>
                     )}

                     {/* S3 Config (Simplified) */}
                     {a.type === 's3' && (
                        <div className="mt-1 grid grid-cols-1 gap-2 rounded-xl border border-[rgb(var(--wb-color-status-warning)/0.24)] bg-[rgb(var(--wb-color-status-warning)/0.08)] p-2">
                             <div className="flex items-center gap-1 text-[10px] font-bold text-[rgb(var(--wb-color-status-warning))]"><Cloud size={10}/> S3 Configuration</div>
                             <input placeholder="Bucket" value={a.s3?.bucket || ''} onChange={(e) => handleArtifactChange(type, idx, 's3.bucket', e.target.value)} className={smallInputClass} />
                             <input placeholder="Key" value={a.s3?.key || ''} onChange={(e) => handleArtifactChange(type, idx, 's3.key', e.target.value)} className={smallInputClass} />
                        </div>
                     )}

                     {type === 'inputs' && (
                        <div className="mt-2">
                            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[rgb(var(--wb-color-text-muted))]">From (Reference)</label>
                            <input
                                placeholder="{{steps.step-name.outputs.artifacts.artifact-name}}"
                                value={a.from || ''}
                                onChange={(e) => handleArtifactChange(type, idx, 'from', e.target.value)}
                                className={`${smallInputClass} font-mono w-full`}
                            />
                        </div>
                     )}
                </div>
             ))}
             {(!artifacts.length) && <div className={emptyStateClass}>No {type} artifacts defined.</div>}
         </div>
      );
  };

  return (
    <div className="wb-tokenized-panel flex h-full w-full flex-col overflow-hidden bg-[rgb(var(--wb-color-bg-surface))]" id="config-panel">
      {/* Header */}
      <div className="border-b border-[rgb(var(--wb-color-border-subtle)/0.44)] bg-[rgb(var(--wb-color-bg-surface)/0.94)]">
        <div className="p-4 flex justify-between items-center">
            <div>
                <h2 className={`flex items-center gap-2 text-sm ${sectionTitleClass}`}>
                    <Settings size={14} className={mutedTextClass} />
                    {formData.label}
                </h2>
                <p className={`mt-1 text-[10px] font-medium uppercase tracking-wider ${mutedTextClass}`}>{formData.type}</p>
            </div>

            <button
                onClick={() => canUseAI && setShowAiEdit(!showAiEdit)}
                disabled={!canUseAI}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${showAiEdit ? accentButtonClass : subtleButtonClass}`}
            >
                <Sparkles size={12} />
                Edit with AI
                {showAiEdit ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
            </button>
        </div>

        {/* AI Edit Overlay */}
        {showAiEdit && canUseAI && (
            <div className="px-4 pb-4 animate-fade-in-down border-b border-[rgb(var(--wb-color-border-subtle)/0.44)] bg-[rgb(var(--wb-color-bg-surface-hover)/0.62)]">
                 <div className={`${sectionCardClass} p-3`}>
                    <label className={`mb-1.5 block text-[10px] font-semibold uppercase tracking-wider ${mutedTextClass}`}>AI Instruction</label>
                    <div className="flex gap-2">
                        <textarea
                            value={aiPrompt}
                            onChange={(e) => setAiPrompt(e.target.value)}
                            className="flex-1 resize-none rounded-md border border-[rgb(var(--wb-color-border-subtle)/0.38)] bg-[rgb(var(--wb-color-bg-base))] p-2 font-sans text-xs text-[rgb(var(--wb-color-text-primary))] outline-none transition-colors placeholder:text-[rgb(var(--wb-color-text-muted))] focus-visible:border-[rgb(var(--wb-color-border-subtle)/0.7)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--wb-color-accent-primary)/0.22)] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--wb-color-bg-surface))]"
                            placeholder="e.g. Change image to node:18, add environment variable API_KEY, and set memory limit to 1Gi"
                            rows={2}
                        />
                        <button
                            onClick={handleAiEdit}
                            aria-label="Apply AI instruction"
                            disabled={aiLoading || !aiPrompt.trim()}
                            className="flex items-center justify-center rounded-lg border border-[rgb(var(--wb-color-accent-primary)/0.34)] bg-[rgb(var(--wb-color-accent-primary))] px-3 py-1 text-white transition-colors hover:bg-[rgb(var(--wb-color-accent-primary-hover))] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {aiLoading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRightCircle size={16} />}
                        </button>
                    </div>
                 </div>
            </div>
        )}
        {aiError && (
          <div role="alert" className="mx-4 mb-4 rounded-md border border-[rgb(var(--wb-color-status-error)/0.4)] bg-[rgb(var(--wb-color-status-error)/0.08)] p-3 text-sm text-[rgb(var(--wb-color-status-error))]">
            {aiError}
          </div>
        )}
      </div>

      <div className="flex gap-1 border-b border-[rgb(var(--wb-color-border-subtle)/0.44)] bg-[rgb(var(--wb-color-bg-surface)/0.94)] px-3 py-2">
            <button onClick={() => setActiveTab('props')} className={`flex-1 flex justify-center py-1.5 rounded-lg text-xs font-medium transition-colors ${activeTab === 'props' ? 'bg-[rgb(var(--wb-color-bg-surface-active)/0.84)] text-[rgb(var(--wb-color-text-primary))]' : 'text-[rgb(var(--wb-color-text-secondary))] hover:text-[rgb(var(--wb-color-text-primary))] hover:bg-[rgb(var(--wb-color-bg-surface-hover)/0.72)]'}`} title="Properties">
                Properties
            </button>
            <button onClick={() => setActiveTab('logic')} className={`flex-1 flex justify-center py-1.5 rounded-lg text-xs font-medium transition-colors ${activeTab === 'logic' ? 'bg-[rgb(var(--wb-color-bg-surface-active)/0.84)] text-[rgb(var(--wb-color-text-primary))]' : 'text-[rgb(var(--wb-color-text-secondary))] hover:text-[rgb(var(--wb-color-text-primary))] hover:bg-[rgb(var(--wb-color-bg-surface-hover)/0.72)]'}`} title="Flow Logic">
                Logic
            </button>
             <button onClick={() => setActiveTab('io')} className={`flex-1 flex justify-center py-1.5 rounded-lg text-xs font-medium transition-colors ${activeTab === 'io' ? 'bg-[rgb(var(--wb-color-bg-surface-active)/0.84)] text-[rgb(var(--wb-color-text-primary))]' : 'text-[rgb(var(--wb-color-text-secondary))] hover:text-[rgb(var(--wb-color-text-primary))] hover:bg-[rgb(var(--wb-color-bg-surface-hover)/0.72)]'}`} title="Inputs/Outputs">
                I/O
            </button>
            <button onClick={() => setActiveTab('adv')} className={`flex-1 flex justify-center py-1.5 rounded-lg text-xs font-medium transition-colors ${activeTab === 'adv' ? 'bg-[rgb(var(--wb-color-bg-surface-active)/0.84)] text-[rgb(var(--wb-color-text-primary))]' : 'text-[rgb(var(--wb-color-text-secondary))] hover:text-[rgb(var(--wb-color-text-primary))] hover:bg-[rgb(var(--wb-color-bg-surface-hover)/0.72)]'}`} title="Advanced">
                Advanced
            </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-6">

        {/* === PROPERTIES TAB === */}
        {activeTab === 'props' && (
            <div className="space-y-5">
                <div className="space-y-2">
                    <label className={labelClass}>Step Name</label>
                    <input
                        value={formData.label || ''}
                        onChange={(e) => updateField(['label'], e.target.value)}
                        className={inputBaseClass}
                    />
                </div>

                <div className="space-y-2">
                    <label className={labelClass}>Description</label>
                    <textarea
                        value={formData.description || ''}
                        onChange={(e) => updateField(['description'], e.target.value)}
                        className={`${inputBaseClass} min-h-[60px] resize-y`}
                        placeholder="Describe what this step does..."
                        rows={2}
                    />
                </div>

                {/* --- CONTAINER CONFIG --- */}
                {formData.type === 'container' && (
                    <>
                        <div className="space-y-2">
                            <label className={labelClass}>Image</label>
                            <input
                                value={getContainer().image}
                                onChange={(e) => updateField(['container', 'image'], e.target.value)}
                                className={`${inputBaseClass} font-mono`}
                                placeholder="e.g. alpine:latest"
                            />
                        </div>
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <label className={labelClass}>Command</label>
                                <button onClick={() => setFullScreenEditor({ isOpen: true, title: 'Container Command', value: getContainer().command || '', language: 'shell', path: ['container', 'command'] })} className={iconButtonClass}><Maximize2 size={14} /></button>
                            </div>
                            <div className={`h-32 ${editorFrameClass}`}>
                                <Editor
                                    height="100%"
                                    defaultLanguage="shell"
                                    theme={editorTheme}
                                    value={getContainer().command}
                                    onChange={(value) => updateField(['container', 'command'], value || '')}
                                    options={{ minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 12, wordWrap: 'on', fixedOverflowWidgets: true }}
                                />
                            </div>
                        </div>
                        {/* Env Vars */}
                        <div className="space-y-2">
                             <div className="flex justify-between items-center">
                                <label className={labelClass}>Environment</label>
                                <button onClick={() => addNameValue(['container', 'env'])} className={`flex items-center gap-1 ${inlineActionClass}`}><Plus size={10}/> Add</button>
                             </div>
                             {(getContainer().env || []).map((env: NameValue, idx: number) => (
                                 <div key={idx} className="flex gap-2">
                                     <input placeholder="KEY" value={env.name} onChange={(e) => handleNameValueChange(['container', 'env'], idx, 'name', e.target.value)} className={`w-1/2 ${smallInputClass} font-mono`} />
                                     <input placeholder="VALUE" value={env.value} onChange={(e) => handleNameValueChange(['container', 'env'], idx, 'value', e.target.value)} className={`w-1/2 ${smallInputClass} font-mono`} />
                                     <button onClick={() => removeNameValue(['container', 'env'], idx)} className={removeButtonClass}><X size={14} /></button>
                                 </div>
                             ))}
                        </div>
                        {/* Resources */}
                        <div className={`border-t pt-2 ${dividerClass}`}>
                            <label className={`${labelClass} flex items-center gap-2 mb-2`}>
                                <Cpu size={14} /> Resources
                            </label>
                            <div className={`${sectionCardClass} grid grid-cols-2 gap-3 p-3`}>
                                {/* Requests */}
                                <div className="space-y-2">
                                    <span className={`block text-center text-[10px] font-bold uppercase tracking-wider ${mutedTextClass}`}>Requests</span>
                                    <div>
                                        <div className="flex items-center gap-1 mb-1">
                                            <Cpu size={10} className={mutedTextClass} />
                                            <span className={`text-[10px] font-semibold ${mutedTextClass}`}>CPU</span>
                                        </div>
                                        <input
                                            placeholder="100m"
                                            value={getContainer().resources?.requests?.cpu || ''}
                                            onChange={(e) => updateField(['container', 'resources', 'requests', 'cpu'], e.target.value)}
                                            className={`w-full font-mono ${smallInputClass} p-1.5`}
                                        />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-1 mb-1">
                                            <HardDrive size={10} className={mutedTextClass} />
                                            <span className={`text-[10px] font-semibold ${mutedTextClass}`}>Mem</span>
                                        </div>
                                        <input
                                            placeholder="128Mi"
                                            value={getContainer().resources?.requests?.memory || ''}
                                            onChange={(e) => updateField(['container', 'resources', 'requests', 'memory'], e.target.value)}
                                            className={`w-full font-mono ${smallInputClass} p-1.5`}
                                        />
                                    </div>
                                </div>
                                {/* Limits */}
                                <div className={`space-y-2 border-l pl-3 ${dividerClass}`}>
                                    <span className={`block text-center text-[10px] font-bold uppercase tracking-wider ${mutedTextClass}`}>Limits</span>
                                    <div>
                                        <div className="flex items-center gap-1 mb-1">
                                            <Cpu size={10} className={mutedTextClass} />
                                            <span className={`text-[10px] font-semibold ${mutedTextClass}`}>CPU</span>
                                        </div>
                                        <input
                                            placeholder="500m"
                                            value={getContainer().resources?.limits?.cpu || ''}
                                            onChange={(e) => updateField(['container', 'resources', 'limits', 'cpu'], e.target.value)}
                                            className={`w-full font-mono ${smallInputClass} p-1.5`}
                                        />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-1 mb-1">
                                            <HardDrive size={10} className={mutedTextClass} />
                                            <span className={`text-[10px] font-semibold ${mutedTextClass}`}>Mem</span>
                                        </div>
                                        <input
                                            placeholder="512Mi"
                                            value={getContainer().resources?.limits?.memory || ''}
                                            onChange={(e) => updateField(['container', 'resources', 'limits', 'memory'], e.target.value)}
                                            className={`w-full font-mono ${smallInputClass} p-1.5`}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                         {/* Volume Mounts */}
                        <div className={`border-t pt-2 ${dividerClass}`}>
                             <div className="flex justify-between items-center mb-2">
                                <label className={`${labelClass} flex items-center gap-2`}>
                                    <FolderOpen size={14} /> Volume Mounts
                                </label>
                                <button onClick={() => addVolumeMount(['container', 'volumeMounts'])} className={`flex items-center gap-1 ${inlineActionClass}`}><Plus size={10}/> Add</button>
                             </div>
                             {(getContainer().volumeMounts || []).map((vm: any, idx: number) => (
                                 <div key={idx} className="flex gap-2 mb-2">
                                     <input placeholder="vol-name" value={vm.name} onChange={(e) => handleVolumeMountChange(['container', 'volumeMounts'], idx, 'name', e.target.value)} className={`w-1/2 ${smallInputClass} font-mono`} />
                                     <input placeholder="/mnt/path" value={vm.mountPath} onChange={(e) => handleVolumeMountChange(['container', 'volumeMounts'], idx, 'mountPath', e.target.value)} className={`w-1/2 ${smallInputClass} font-mono`} />
                                     <button onClick={() => removeVolumeMount(['container', 'volumeMounts'], idx)} className={removeButtonClass}><X size={14} /></button>
                                 </div>
                             ))}
                             {!(getContainer().volumeMounts?.length) && <div className={`${emptyStateClass} p-1`}>No volumes mounted.</div>}
                        </div>
                    </>
                )}

                {/* --- HTTP CONFIG --- */}
                {formData.type === 'http' && (
                    <>
                        <div className="space-y-2">
                            <label className={labelClass}>Method & URL</label>
                            <div className="flex gap-2">
                                <select
                                    value={getHttp().method}
                                    onChange={(e) => updateField(['http', 'method'], e.target.value)}
                                    className={`w-24 bg-[rgb(var(--wb-color-bg-base)/0.82)] text-sm font-bold ${smallInputClass}`}
                                >
                                    {['GET', 'POST', 'PUT', 'DELETE'].map(m => <option key={m}>{m}</option>)}
                                </select>
                                <input
                                    value={getHttp().url}
                                    onChange={(e) => updateField(['http', 'url'], e.target.value)}
                                    className={`${inputBaseClass} flex-1 font-mono`}
                                    placeholder="https://api..."
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                             <div className="flex justify-between items-center">
                                <label className={labelClass}>Headers</label>
                                <button onClick={() => addNameValue(['http', 'headers'])} className={`flex items-center gap-1 ${inlineActionClass}`}><Plus size={10}/> Add</button>
                             </div>
                             {(getHttp().headers || []).map((h: NameValue, idx: number) => (
                                 <div key={idx} className="flex gap-2">
                                     <input placeholder="Header" value={h.name} onChange={(e) => handleNameValueChange(['http', 'headers'], idx, 'name', e.target.value)} className={`w-1/2 ${smallInputClass} font-mono`} />
                                     <input placeholder="Value" value={h.value} onChange={(e) => handleNameValueChange(['http', 'headers'], idx, 'value', e.target.value)} className={`w-1/2 ${smallInputClass} font-mono`} />
                                     <button onClick={() => removeNameValue(['http', 'headers'], idx)} className={removeButtonClass}><X size={14} /></button>
                                 </div>
                             ))}
                        </div>
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <label className={labelClass}>Request Body</label>
                                <button onClick={() => setFullScreenEditor({ isOpen: true, title: 'Request Body', value: getHttp().body || '', language: 'json', path: ['http', 'body'] })} className={iconButtonClass}><Maximize2 size={14} /></button>
                            </div>
                            <div className={`h-40 ${editorFrameClass}`}>
                                <Editor
                                    height="100%"
                                    defaultLanguage="json"
                                    theme={editorTheme}
                                    value={getHttp().body || ''}
                                    onChange={(value) => updateField(['http', 'body'], value || '')}
                                    options={{ minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 12, wordWrap: 'on', fixedOverflowWidgets: true }}
                                />
                            </div>
                        </div>
                    </>
                )}

                 {/* --- SCRIPT CONFIG (INLINE TEMPLATE) --- */}
                 {formData.type === 'script' && (
                     <>
                        <div className="space-y-2">
                            <label className={labelClass}>Interpreter Image</label>
                            <input
                                value={getScript().image}
                                onChange={(e) => updateField(['script', 'image'], e.target.value)}
                                className={`${inputBaseClass} font-mono`}
                            />
                        </div>
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <label className={labelClass}>Source Code</label>
                                <button onClick={() => setFullScreenEditor({ isOpen: true, title: 'Source Code', value: getScript().source || '', language: getScript().image?.includes('python') ? 'python' : 'shell', path: ['script', 'source'] })} className={iconButtonClass}><Maximize2 size={14} /></button>
                            </div>
                            <div className={`h-64 ${editorFrameClass}`}>
                                <Editor
                                    height="100%"
                                    defaultLanguage={getScript().image?.includes('python') ? 'python' : 'shell'}
                                    theme={editorTheme}
                                    value={getScript().source}
                                    onChange={(value) => updateField(['script', 'source'], value || '')}
                                    options={{ minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 12, wordWrap: 'on', fixedOverflowWidgets: true }}
                                />
                            </div>
                        </div>
                     </>
                 )}

                 {/* --- RESOURCE CONFIG --- */}
                 {formData.type === 'resource' && (
                     <>
                        <div className="space-y-2">
                             <label className={labelClass}>Action</label>
                             <select
                                value={getResource().action}
                                onChange={(e) => updateField(['resource', 'action'], e.target.value)}
                                className={inputBaseClass}
                            >
                                <option value="create">Create</option>
                                <option value="apply">Apply</option>
                                <option value="delete">Delete</option>
                                <option value="patch">Patch</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                             <div className="flex justify-between items-center">
                                 <label className={`${labelClass} flex items-center gap-2`}>
                                    <Code size={12}/> Manifest (YAML)
                                 </label>
                                 <button onClick={() => setFullScreenEditor({ isOpen: true, title: 'Manifest (YAML)', value: getResource().manifest || '', language: 'yaml', path: ['resource', 'manifest'] })} className={iconButtonClass}><Maximize2 size={14} /></button>
                             </div>
                             <div className="h-[30rem] overflow-hidden rounded-xl">
                                <YamlDocumentEditor
                                    title="Resource Manifest"
                                    value={getResource().manifest || ''}
                                    path={yamlModelPaths.resourceManifest}
                                    compact
                                    helpText="Use the shared YAML editor for syntax coloring, inline diagnostics, and consistent editing actions."
                                    applyLabel="Apply manifest"
                                    applySuccessMessage="Manifest YAML was applied to the resource step."
                                    downloadFileName={`${formData.label || 'resource-manifest'}.yaml`}
                                    onApply={(value) => updateField(['resource', 'manifest'], value)}
                                />
                             </div>
                        </div>
                     </>
                 )}

                 {/* --- CONTAINER SET CONFIG --- */}
                 {formData.type === 'container-set' && (
                     <div className="space-y-4">
                        <div className={`flex items-center justify-between border-b pb-2 ${dividerClass}`}>
                             <label className={`${labelClass} flex items-center gap-2`}>
                                <Layers size={14}/> Containers
                             </label>
                             <button onClick={addContainer} className={`flex items-center gap-1 ${inlineActionClass}`}><Plus size={10}/> Add</button>
                        </div>

                        {/* Container List Tabs */}
                        <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
                            {getContainerSet().containers.map((c: ContainerConfig, idx: number) => (
                                <button
                                    key={idx}
                                    onClick={() => setActiveContainerIdx(idx)}
                                    className={`px-3 py-1 text-xs rounded-full whitespace-nowrap border transition-all ${
                                        activeContainerIdx === idx
                                        ? 'bg-[rgb(var(--wb-color-accent-primary)/0.14)] text-[rgb(var(--wb-color-accent-primary))] border-[rgb(var(--wb-color-accent-primary)/0.28)] font-bold'
                                        : 'bg-[rgb(var(--wb-color-bg-surface-hover)/0.7)] text-[rgb(var(--wb-color-text-secondary))] border-[rgb(var(--wb-color-border-subtle)/0.52)] hover:border-[rgb(var(--wb-color-accent-primary)/0.24)] hover:bg-[rgb(var(--wb-color-bg-surface)/0.86)]'
                                    }`}
                                >
                                    {c.name || `ctr-${idx}`}
                                </button>
                            ))}
                        </div>

                        {/* Selected Container Editor */}
                        {getContainerSet().containers[activeContainerIdx] && (
                            <div className={`${sectionCardClass} relative space-y-4 p-4 animate-fade-in`}>
                                <button
                                    onClick={() => removeContainer(activeContainerIdx)}
                                    className={`absolute right-3 top-3 ${removeButtonClass}`}
                                    title="Remove Container"
                                >
                                    <X size={14} />
                                </button>

                                <div className="space-y-1">
                                    <label className={`text-[10px] font-bold uppercase ${mutedTextClass}`}>Container Name</label>
                                    <input
                                        value={getContainerSet().containers[activeContainerIdx].name}
                                        onChange={(e) => updateContainerField(activeContainerIdx, 'name', e.target.value)}
                                        className={smallInputClass}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className={`text-[10px] font-bold uppercase ${mutedTextClass}`}>Image</label>
                                    <input
                                        value={getContainerSet().containers[activeContainerIdx].image}
                                        onChange={(e) => updateContainerField(activeContainerIdx, 'image', e.target.value)}
                                        className={`${smallInputClass} font-mono`}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className={`text-[10px] font-bold uppercase ${mutedTextClass}`}>Command</label>
                                    <input
                                        value={getContainerSet().containers[activeContainerIdx].command}
                                        onChange={(e) => updateContainerField(activeContainerIdx, 'command', e.target.value)}
                                        className={`${smallInputClass} font-mono`}
                                    />
                                </div>

                                {/* Mini Resource Config for ContainerSet */}
                                <div className={`grid grid-cols-2 gap-2 border-t pt-2 ${dividerClass}`}>
                                    <div>
                                         <label className={`text-[9px] font-bold uppercase ${mutedTextClass}`}>CPU Request</label>
                                         <input
                                            placeholder="100m"
                                            value={getContainerSet().containers[activeContainerIdx].resources?.requests?.cpu || ''}
                                            onChange={(e) => updateContainerField(activeContainerIdx, 'resources.requests.cpu', e.target.value)}
                                            className={`${smallInputClass} text-[10px] p-1.5`}
                                         />
                                    </div>
                                    <div>
                                         <label className={`text-[9px] font-bold uppercase ${mutedTextClass}`}>Mem Request</label>
                                         <input
                                            placeholder="128Mi"
                                            value={getContainerSet().containers[activeContainerIdx].resources?.requests?.memory || ''}
                                            onChange={(e) => updateContainerField(activeContainerIdx, 'resources.requests.memory', e.target.value)}
                                            className={`${smallInputClass} text-[10px] p-1.5`}
                                         />
                                    </div>
                                </div>
                            </div>
                        )}
                     </div>
                 )}

                 {/* --- SUSPEND CONFIG --- */}
                 {formData.type === 'suspend' && (
                     <div className="space-y-2">
                         <label className={labelClass}>Wait Duration</label>
                         <input
                            value={formData.suspend?.duration || ''}
                            onChange={(e) => updateField(['suspend', 'duration'], e.target.value)}
                            placeholder="60s"
                            className={inputBaseClass}
                         />
                     </div>
                 )}

                 {/* --- SUB-WORKFLOW CONFIG --- */}
                 {formData.type === 'sub-workflow' && (
                     <div className="space-y-2">
                         <label className={labelClass}>Target Workflow</label>
                         <select
                            value={formData.subWorkflow?.workflowId || ''}
                            onChange={(e) => {
                                const selectedOption = e.target.options[e.target.selectedIndex];
                                updateField(['subWorkflow', 'workflowId'], e.target.value);
                                updateField(['subWorkflow', 'workflowName'], selectedOption.text);
                            }}
                            className={inputBaseClass}
                         >
                            <option value="">Select a workflow...</option>
                            {draftMirrorStorage.load().sessions.map((session: any) => (
                                <option key={session.id} value={session.id}>{session.name}</option>
                            ))}
                         </select>
                         <p className={`mt-1 text-[10px] ${mutedTextClass}`}>Select an existing workflow session to trigger.</p>
                     </div>
                 )}
            </div>
        )}

        {/* === LOGIC TAB === */}
        {activeTab === 'logic' && (
            <div className="space-y-6">
                {/* Condition */}
                <div className="space-y-2">
                    <label className={`${labelClass} flex items-center gap-2`}>
                        <Split size={14} /> Conditional Execution (When)
                    </label>
                    <input
                        value={formData.flowControl?.when || ''}
                        onChange={(e) => updateField(['flowControl', 'when'], e.target.value)}
                        placeholder="{{steps.prev-step.outputs.result}} == true"
                        className={`${inputBaseClass} font-mono text-xs`}
                    />
                    <p className={`text-[10px] ${mutedTextClass}`}>Argo expression to determine if this step should run.</p>
                </div>

                {/* Loops */}
                <div className={`space-y-2 border-t pt-4 ${dividerClass}`}>
                    <label className={`${labelClass} flex items-center gap-2`}>
                        <Repeat size={14} /> Loop Strategy
                    </label>
                    <select
                        value={formData.flowControl?.loop?.type || ''}
                        onChange={(e) => {
                             const val = e.target.value;
                             if (!val) updateField(['flowControl', 'loop'], undefined);
                             else updateField(['flowControl', 'loop'], { type: val, value: '' });
                        }}
                        className={inputBaseClass}
                    >
                        <option value="">None (Single Run)</option>
                        <option value="withItems">With Items (JSON List)</option>
                        <option value="withParam">With Param (JSON String)</option>
                    </select>

                    {formData.flowControl?.loop?.type === 'withItems' && (
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <label className={labelClass}>Items (JSON)</label>
                                <button onClick={() => setFullScreenEditor({ isOpen: true, title: 'Loop Items', value: formData.flowControl?.loop?.value || '', language: 'json', path: ['flowControl', 'loop', 'value'] })} className={iconButtonClass}><Maximize2 size={14} /></button>
                            </div>
                            <div className={`h-32 ${editorFrameClass}`}>
                                <Editor
                                    height="100%"
                                    defaultLanguage="json"
                                    theme={editorTheme}
                                    value={formData.flowControl.loop.value}
                                    onChange={(value) => updateField(['flowControl', 'loop', 'value'], value || '')}
                                    options={{ minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 12, wordWrap: 'on', fixedOverflowWidgets: true }}
                                />
                            </div>
                        </div>
                    )}
                    {formData.flowControl?.loop?.type === 'withParam' && (
                        <input
                            value={formData.flowControl.loop.value}
                            onChange={(e) => updateField(['flowControl', 'loop', 'value'], e.target.value)}
                            placeholder='{{steps.previous.outputs.parameters.json-list}}'
                            className={`${inputBaseClass} font-mono`}
                        />
                    )}
                </div>
            </div>
        )}

        {/* === INPUTS/OUTPUTS TAB === */}
        {activeTab === 'io' && (
            <div className="space-y-8">
                {/* Inputs */}
                <div className="space-y-4">
                    <h3 className={`border-b pb-1 text-xs font-bold ${sectionTitleClass} ${dividerClass}`}>Inputs</h3>

                    {/* Input Params */}
                    <div className="space-y-2">
                         <div className="flex justify-between items-center">
                            <label className={labelClass}>Parameters</label>
                            <button onClick={() => addNameValue(['inputs', 'parameters'])} className={`flex items-center gap-1 ${inlineActionClass}`}><Plus size={10}/> Add</button>
                         </div>
                         {(formData.inputs?.parameters || []).map((p: NameValue, idx: number) => (
                             <div key={idx} className="flex gap-2">
                                 <input placeholder="Name" value={p.name} onChange={(e) => handleNameValueChange(['inputs', 'parameters'], idx, 'name', e.target.value)} className={`w-1/3 ${smallInputClass}`} />
                                 <input placeholder="Default / Value" value={p.value} onChange={(e) => handleNameValueChange(['inputs', 'parameters'], idx, 'value', e.target.value)} className={`flex-1 ${smallInputClass}`} />
                                 <button onClick={() => removeNameValue(['inputs', 'parameters'], idx)} className={removeButtonClass}><X size={14} /></button>
                             </div>
                         ))}
                         {!(formData.inputs?.parameters?.length) && <div className={emptyStateClass}>No input parameters.</div>}
                    </div>

                    {/* Input Artifacts */}
                    {renderArtifactForm('inputs')}
                </div>

                {/* Outputs */}
                <div className="space-y-4">
                    <h3 className={`border-b pb-1 text-xs font-bold ${sectionTitleClass} ${dividerClass}`}>Outputs</h3>

                     {/* Output Params */}
                     <div className="space-y-2">
                         <div className="flex justify-between items-center">
                            <label className={labelClass}>Parameters</label>
                            <button onClick={() => addNameValue(['outputs', 'parameters'])} className={`flex items-center gap-1 ${inlineActionClass}`}><Plus size={10}/> Add</button>
                         </div>
                         {(formData.outputs?.parameters || []).map((p: NameValue, idx: number) => (
                             <div key={idx} className={`${sectionCardClass} relative space-y-1 p-2`}>
                                 <button onClick={() => removeNameValue(['outputs', 'parameters'], idx)} className={`absolute right-2 top-2 ${removeButtonClass}`}><X size={14} /></button>
                                 <input placeholder="Name" value={p.name} onChange={(e) => handleNameValueChange(['outputs', 'parameters'], idx, 'name', e.target.value)} className={`${smallInputClass} w-full`} />
                                 <div className="flex items-center gap-1">
                                    <span className={`text-[10px] ${mutedTextClass}`}>From Path:</span>
                                    <input placeholder="/tmp/result.txt" value={p.valueFrom?.path || ''} onChange={(e) => {
                                        const list = [...(formData.outputs?.parameters || [])];
                                        list[idx] = { ...list[idx], valueFrom: { ...list[idx].valueFrom, path: e.target.value } };
                                        updateField(['outputs', 'parameters'], list);
                                    }} className={`${smallInputClass} flex-1 font-mono`} />
                                 </div>
                             </div>
                         ))}
                         {!(formData.outputs?.parameters?.length) && <div className={emptyStateClass}>No output parameters.</div>}
                    </div>

                    {/* Output Artifacts */}
                    {renderArtifactForm('outputs')}
                </div>
            </div>
        )}

        {/* === ADVANCED TAB === */}
        {activeTab === 'adv' && (
             <div className="space-y-6">
                 {/* Retry Strategy */}
                 <div className="space-y-3">
                    <label className={`${labelClass} flex items-center gap-2`}>
                        <RefreshCw size={14} /> Retry Strategy
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                             <label className={`text-[9px] font-bold uppercase ${mutedTextClass}`}>Limit</label>
                             <input
                                type="number"
                                value={formData.retryStrategy?.limit || ''}
                                onChange={(e) => updateField(['retryStrategy', 'limit'], parseInt(e.target.value))}
                                className={smallInputClass}
                                placeholder="0"
                             />
                        </div>
                        <div>
                             <label className={`text-[9px] font-bold uppercase ${mutedTextClass}`}>Policy</label>
                             <select
                                value={formData.retryStrategy?.retryPolicy || 'OnFailure'}
                                onChange={(e) => updateField(['retryStrategy', 'retryPolicy'], e.target.value)}
                                className={smallInputClass}
                             >
                                 <option value="OnFailure">OnFailure</option>
                                 <option value="OnError">OnError</option>
                                 <option value="Always">Always</option>
                             </select>
                        </div>
                    </div>
                 </div>

                 {/* Timeout */}
                 <div className="space-y-2">
                    <label className={labelClass}>Active Deadline (Seconds)</label>
                    <input
                        type="number"
                        value={formData.activeDeadlineSeconds || ''}
                        onChange={(e) => updateField(['activeDeadlineSeconds'], parseInt(e.target.value))}
                        className={inputBaseClass}
                        placeholder="e.g. 600"
                    />
                 </div>

                 {/* Node Selector */}
                 <div className="space-y-2">
                    <div className="flex justify-between items-center">
                        <label className={labelClass}>Node Selector</label>
                        <button onClick={() => addNameValue(['nodeSelector'])} className={`flex items-center gap-1 ${inlineActionClass}`}><Plus size={10}/> Add</button>
                    </div>
                    {(formData.nodeSelector || []).map((ns: NameValue, idx: number) => (
                        <div key={idx} className="flex gap-2">
                            <input placeholder="Key" value={ns.name} onChange={(e) => handleNameValueChange(['nodeSelector'], idx, 'name', e.target.value)} className={`w-1/2 ${smallInputClass}`} />
                            <input placeholder="Value" value={ns.value} onChange={(e) => handleNameValueChange(['nodeSelector'], idx, 'value', e.target.value)} className={`w-1/2 ${smallInputClass}`} />
                            <button onClick={() => removeNameValue(['nodeSelector'], idx)} className={removeButtonClass}><X size={14} /></button>
                        </div>
                    ))}
                    {!(formData.nodeSelector?.length) && <div className={emptyStateClass}>No selectors defined.</div>}
                 </div>

                 {/* Daemon */}
                 {formData.type === 'container' && (
                     <div className={`flex items-center gap-2 border-t pt-2 ${dividerClass}`}>
                         <input
                            type="checkbox"
                            checked={formData.daemon || false}
                            onChange={(e) => updateField(['daemon'], e.target.checked)}
                            className={checkboxClass}
                         />
                         <span className={`text-sm font-medium ${secondaryTextClass}`}>Run as Daemon</span>
                     </div>
                 )}
             </div>
        )}

      </div>

      <div className="flex flex-col gap-2 border-t border-[rgb(var(--wb-color-border-subtle)/0.44)] bg-[rgb(var(--wb-color-bg-surface-hover)/0.62)] p-4">
        <button
            onClick={() => setShowDeleteConfirmation(true)}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-[rgb(var(--wb-color-border-subtle)/0.56)] bg-[rgba(239,68,68,0.08)] p-2.5 text-sm font-medium text-[rgb(var(--wb-color-status-error))] transition-colors hover:bg-[rgba(239,68,68,0.12)] hover:border-[rgb(var(--wb-color-border-strong)/0.54)]"
        >
            <Trash2 size={16} />
            Delete Step
        </button>
      </div>

      {/* Full Screen Editor Modal */}
      {fullScreenEditor.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(11,18,32,0.42)] p-4 backdrop-blur-sm">
            <div className="wb-tokenized-panel flex h-[80vh] w-full max-w-5xl animate-fade-in-up flex-col overflow-hidden rounded-xl border border-[rgb(var(--wb-color-border-subtle)/0.52)] bg-[rgb(var(--wb-color-bg-surface))] shadow-2xl">
                {fullScreenEditor.language === 'yaml' ? (
                    <YamlDocumentEditor
                        title={fullScreenEditor.title}
                        value={fullScreenEditor.value}
                        path={yamlModelPaths.resourceManifest}
                        helpText="This uses the same YAML editor as the inline manifest view."
                        applyLabel="Save & Close"
                        applySuccessMessage="Manifest YAML was saved."
                        downloadFileName={`${formData.label || 'resource-manifest'}.yaml`}
                        onApply={(value) => {
                            updateField(fullScreenEditor.path, value);
                            setFullScreenEditor({ ...fullScreenEditor, value, isOpen: false });
                        }}
                        onClose={() => setFullScreenEditor({ ...fullScreenEditor, isOpen: false })}
                    />
                ) : (
                    <>
                        <div className="flex items-center justify-between border-b border-[rgb(var(--wb-color-border-subtle)/0.44)] bg-[rgb(var(--wb-color-bg-surface-hover)/0.62)] p-4">
                            <h3 className={`flex items-center gap-2 font-bold ${sectionTitleClass}`}>
                                <Code size={18} className="text-[rgb(var(--wb-color-accent-primary))]" />
                                {fullScreenEditor.title}
                            </h3>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => {
                                        updateField(fullScreenEditor.path, fullScreenEditor.value);
                                        setFullScreenEditor({ ...fullScreenEditor, isOpen: false });
                                    }}
                                    className="rounded-lg border border-[rgb(var(--wb-color-accent-primary)/0.34)] bg-[rgb(var(--wb-color-accent-primary))] px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[rgb(var(--wb-color-accent-primary-hover))]"
                                >
                                    Save & Close
                                </button>
                                <button
                                    onClick={() => setFullScreenEditor({ ...fullScreenEditor, isOpen: false })}
                                    className={iconButtonClass}
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-hidden bg-[rgb(var(--wb-color-bg-base))]">
                        <Editor
                            height="100%"
                            defaultLanguage={fullScreenEditor.language}
                            theme={editorTheme}
                            value={fullScreenEditor.value}
                            onChange={(value) => setFullScreenEditor({ ...fullScreenEditor, value: value || '' })}
                            options={{ minimap: { enabled: true }, scrollBeyondLastLine: false, fontSize: 14, wordWrap: 'on', fixedOverflowWidgets: true }}
                        />
                        </div>
                    </>
                )}
            </div>
        </div>
      )}

      <ConfirmationDialog
        open={showDeleteConfirmation}
        title="Delete step?"
        message="This removes the selected step from the pipeline graph."
        confirmLabel="Delete step"
        tone="danger"
        onClose={() => setShowDeleteConfirmation(false)}
        onConfirm={() => {
            setShowDeleteConfirmation(false);
            onDelete(selectedNode.id);
        }}
      />
    </div>
  );
};

export default NodeConfigPanel;
