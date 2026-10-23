import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, FileJson, Globe, Layers, Database, PauseCircle, Split,
  Repeat, Search, LayoutTemplate,
  ChevronLeft, RefreshCw, AlertCircle, Loader2,
  FileCode2, Table, TrendingUp,
} from 'lucide-react';
import { cn } from '@argocanvas/ui-platform';
import { argoService } from '../services/argoService';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SidebarItem {
  label: string;
  desc: string;
  icon: React.ReactNode;
  data: any;
}

interface RemoteTemplate {
  metadata: { name: string; namespace: string; creationTimestamp?: string };
  spec?: { entrypoint?: string; templates?: any[] };
}

const getTemplateErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message) {
      return message;
    }
  }

  return 'Unable to load templates from Argo.';
};

// ─── Color map ────────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  container:       'bg-[#ff6d5a] text-white border-transparent',
  script:          'bg-[#9b6dd5] text-white border-transparent',
  http:            'bg-[#5fabf7] text-white border-transparent',
  'container-set': 'bg-[#3a42e9] text-white border-transparent',
  resource:        'bg-[#ff965a] text-white border-transparent',
  suspend:         'bg-[#7d7d87] text-white border-transparent',
  pattern:         'bg-[rgb(var(--wb-color-bg-surface-active))] text-[rgb(var(--wb-color-text-secondary))] border-[rgb(var(--wb-color-border-subtle))]',
};

// ─── Drag helper ──────────────────────────────────────────────────────────────

const onDragStart = (event: React.DragEvent, nodeType: string, payload: any) => {
  event.dataTransfer.setData('application/reactflow', nodeType);
  event.dataTransfer.setData('application/payload', JSON.stringify(payload));
  event.dataTransfer.effectAllowed = 'move';
};

// ─── Section label ────────────────────────────────────────────────────────────

const SectionLabel = ({ label }: { label: string }) => (
  <p className="mb-1.5 mt-1 px-0.5 text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--wb-color-text-muted))]">
    {label}
  </p>
);

const cardChromeClass =
  'rounded-md border border-[rgb(var(--wb-color-border-subtle))] bg-[rgb(var(--wb-color-bg-surface))] transition-colors hover:border-[rgb(var(--wb-color-border-strong))] hover:bg-[rgb(var(--wb-color-bg-surface-hover))]';
const searchInputClass =
  'w-full rounded-md border border-[rgb(var(--wb-color-border-subtle)/0.38)] bg-[rgb(var(--wb-color-bg-base))] py-1.5 pl-8 pr-2 text-[11px] text-[rgb(var(--wb-color-text-primary))] outline-none transition-colors placeholder:text-[rgb(var(--wb-color-text-muted))] focus-visible:border-[rgb(var(--wb-color-border-subtle)/0.7)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--wb-color-accent-primary)/0.22)] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--wb-color-bg-surface))]';

// ─── Node card ────────────────────────────────────────────────────────────────

const NodeCard: React.FC<{ item: SidebarItem; type: 'custom' | 'pattern'; payload?: any }> = ({ item, type, payload }) => {
  const colorClass = TYPE_COLORS[item.data?.type || type] || 'border-[rgb(var(--wb-color-border-subtle)/0.3)] bg-[rgb(var(--wb-color-bg-surface-hover))] text-[rgb(var(--wb-color-text-secondary))]';
  const dragPayload = payload ?? item.data;

  return (
    <div
      className={`group flex cursor-grab items-center gap-2 p-2 active:scale-95 ${cardChromeClass}`}
      draggable
      onDragStart={e => onDragStart(e, type, dragPayload)}
      title={item.desc}
    >
      <div className={`p-1.5 rounded-md border shrink-0 transition-transform group-hover:scale-110 ${colorClass}`}>
        {item.icon}
      </div>
      <div className="min-w-0">
        <p className="truncate text-[12px] font-semibold leading-tight text-[rgb(var(--wb-color-text-primary))]">{item.label}</p>
        <p className="truncate text-[10px] text-[rgb(var(--wb-color-text-muted))]">{item.desc}</p>
      </div>
    </div>
  );
};

// ─── Pattern card ─────────────────────────────────────────────────────────────

const PatternCard: React.FC<{ item: any }> = ({ item }) => (
  <div
    className={`group flex cursor-grab items-center gap-2 p-2 active:scale-95 ${cardChromeClass}`}
    draggable
    onDragStart={e => onDragStart(e, 'pattern', { ...item.payload, name: item.label })}
    title={item.desc}
  >
    <div className="shrink-0 rounded-md border border-[rgb(var(--wb-color-border-subtle)/0.3)] bg-[rgb(var(--wb-color-bg-surface-hover))] p-1.5 text-[rgb(var(--wb-color-text-secondary))] transition-transform group-hover:scale-110">
      {item.icon}
    </div>
    <div className="min-w-0 flex-1">
      <p className="truncate text-[12px] font-semibold leading-tight text-[rgb(var(--wb-color-text-primary))]">{item.label}</p>
      <p className="text-[10px] text-[rgb(var(--wb-color-text-muted))]">{item.desc}</p>
      <div className="flex gap-0.5 mt-1">
        {item.payload.nodes.map((_: any, i: number) => (
          <div key={i} className="h-1 w-5 rounded-full bg-[rgb(var(--wb-color-border-subtle))] transition-colors group-hover:bg-[rgb(var(--wb-color-accent-primary))]" />
        ))}
      </div>
    </div>
  </div>
);

// ─── Template card ────────────────────────────────────────────────────────────

const TemplateCard: React.FC<{ tmpl: RemoteTemplate }> = ({ tmpl }) => {
  const name = tmpl.metadata?.name || 'Unknown';
  const ns   = tmpl.metadata?.namespace || 'default';
  const ct   = tmpl.spec?.templates?.length ?? 0;

  // Pass the full raw template so onDrop can expand it into individual nodes
  const payload = { name, namespace: ns, rawTemplate: tmpl };

  return (
    <div
      className={`group flex cursor-grab items-center gap-2 p-2 active:scale-95 ${cardChromeClass}`}
      draggable
      onDragStart={e => onDragStart(e, 'workflow-template', payload)}
      title={`${name} (${ns}) — Drop to expand ${ct} step${ct !== 1 ? 's' : ''}`}
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[#2fb67c] text-white transition-transform group-hover:scale-105">
        <FileCode2 size={14} />
      </div>
      <div className="min-w-0">
        <p className="truncate text-[12px] font-semibold leading-tight text-[rgb(var(--wb-color-text-primary))]">{name}</p>
        <p className="truncate text-[10px] text-[rgb(var(--wb-color-text-muted))]">{ns} · {ct} step{ct !== 1 ? 's' : ''}</p>
      </div>
    </div>
  );
};

// ─── Main Sidebar ─────────────────────────────────────────────────────────────

const Sidebar: React.FC = () => {
  const [panelOpen, setPanelOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'library' | 'templates'>('library');
  const [search, setSearch] = useState('');

  // Remote templates
  const [templates, setTemplates]         = useState<RemoteTemplate[]>([]);
  const [templatesLoading, setLoading]    = useState(false);
  const [templatesError, setError]        = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setTemplates(await argoService.listWorkflowTemplates() || []);
    } catch (error) {
      setTemplates([]);
      setError(getTemplateErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (activeTab === 'templates') fetchTemplates(); }, [activeTab, fetchTemplates]);

  const openTab = (tab: 'library' | 'templates') => {
    setActiveTab(tab);
    setPanelOpen(true);
  };

  // ── Library data ──────────────────────────────────────────────────────────

  const primitives: SidebarItem[] = [
    { label: 'Container',     desc: 'Docker image step',       icon: <Box size={14} />,        data: { type: 'container',     label: 'Container',     container: { image: 'alpine:latest', command: 'echo hello' } } },
    { label: 'Script',        desc: 'Python / Bash inline',    icon: <FileJson size={14} />,   data: { type: 'script',        label: 'Script',        script: { image: 'python:3.9', source: 'print("hello")' } } },
    { label: 'HTTP Request',  desc: 'Call an external API',    icon: <Globe size={14} />,      data: { type: 'http',          label: 'HTTP Req',      http: { method: 'GET', url: 'https://api.example.com' } } },
    { label: 'Container Set', desc: 'Multi-container sidecar', icon: <Layers size={14} />,     data: { type: 'container-set', label: 'Sidecars',      containerSet: { containers: [{ image: 'nginx', name: 'main' }, { image: 'redis', name: 'cache' }] } } },
    { label: 'K8s Resource',  desc: 'Create / Delete K8s obj', icon: <Database size={14} />,   data: { type: 'resource',      label: 'K8s Resource',  resource: { action: 'create', manifest: 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: my-config' } } },
    { label: 'Suspend',       desc: 'Pause / await approval',  icon: <PauseCircle size={14} />,data: { type: 'suspend',       label: 'Pause',         suspend: { duration: '60s' } } },
  ];

  const flowControl: SidebarItem[] = [
    { label: 'Conditional', desc: 'Run if condition matches',  icon: <Split size={14} />,  data: { type: 'container', label: 'If Matches',  container: { image: 'alpine', command: 'echo matched' }, flowControl: { when: "{{tasks.prev.outputs.result}} == true" } } },
    { label: 'Loop (Map)',  desc: 'Fan-out over a list',       icon: <Repeat size={14} />, data: { type: 'container', label: 'Process Item', container: { image: 'alpine', command: 'echo {{item}}' }, flowControl: { loop: { type: 'withItems', value: '["a","b","c"]' } } } },
  ];

  const patterns = [
    { label: 'ETL (GCS→BQ)',         desc: 'Extract Transform Load',     icon: <Table size={14} />,      payload: { type:'pattern', nodes:[{id:'p1',type:'custom',data:{type:'container',label:'Extract GCS',container:{image:'google/cloud-sdk:slim',command:'gsutil cp gs://{{inputs.parameters.bucket}}/{{inputs.parameters.file}} /tmp/data.csv'},outputs:{artifacts:[{name:'data',path:'/tmp/data.csv'}]}},position:{x:0,y:0}},{id:'p2',type:'custom',data:{type:'script',label:'Transform',script:{image:'python:3.9',source:'import pandas as pd\ndf=pd.read_csv("/tmp/data.csv")\ndf.dropna(inplace=True)\ndf.to_csv("/tmp/clean.csv",index=False)'},inputs:{artifacts:[{name:'input-data',path:'/tmp/data.csv',from:'{{tasks.extract-gcs.outputs.artifacts.data}}'}]},outputs:{artifacts:[{name:'clean',path:'/tmp/clean.csv'}]}},position:{x:300,y:0}},{id:'p3',type:'custom',data:{type:'container',label:'Load BigQuery',container:{image:'google/cloud-sdk:slim',command:'bq load --source_format=CSV mydataset.mytable /tmp/clean.csv'},inputs:{artifacts:[{name:'clean-data',path:'/tmp/clean.csv',from:'{{tasks.transform.outputs.artifacts.clean}}'}]}},position:{x:600,y:0}}], edges:[{id:'e1',source:'p1',target:'p2',type:'smoothstep'},{id:'e2',source:'p2',target:'p3',type:'smoothstep'}] } },
    { label: 'Monte Carlo Sim',       desc: 'Fan-out financial calc',     icon: <TrendingUp size={14} />, payload: { type:'pattern', nodes:[{id:'mc1',type:'custom',data:{type:'script',label:'Gen Scenarios',script:{image:'python:3.9',source:'import json,random\nscenarios=[{"id":i,"vol":random.uniform(0.1,0.5)} for i in range(100)]\nprint(json.dumps(scenarios))'},outputs:{parameters:[{name:'scenarios',valueFrom:{path:'/tmp/output'}}]}},position:{x:0,y:0}},{id:'mc2',type:'custom',data:{type:'script',label:'Simulate',script:{image:'python:numpy',source:'import numpy as np\nprint("Sim complete")'},flowControl:{loop:{type:'withParam',value:'{{tasks.gen-scenarios.outputs.parameters.scenarios}}'}}},position:{x:300,y:0}},{id:'mc3',type:'custom',data:{type:'script',label:'Aggregate',script:{image:'python:pandas',source:'print("Aggregating results...")'}},position:{x:600,y:0}}], edges:[{id:'emc1',source:'mc1',target:'mc2',type:'smoothstep'},{id:'emc2',source:'mc2',target:'mc3',type:'smoothstep'}] } },
  ];

  // ── Filter ────────────────────────────────────────────────────────────────

  const q = search.toLowerCase();
  const f = <T extends { label: string; desc: string }>(arr: T[]) =>
    q ? arr.filter(i => i.label.toLowerCase().includes(q) || i.desc.toLowerCase().includes(q)) : arr;

  const filteredTemplates = templates.filter(t => !q || t.metadata?.name?.toLowerCase().includes(q));

  const tabToggle = (
    <div className="flex items-center rounded-md border border-[rgb(var(--wb-color-border-subtle))] bg-[rgb(var(--wb-color-bg-base))] p-0.5">
      <button
        type="button"
        title="Library"
        onClick={() => (panelOpen ? setActiveTab('library') : openTab('library'))}
        className={cn(
          'h-7 flex-1 rounded-[5px] px-3 text-xs font-semibold transition-colors',
          activeTab === 'library'
            ? 'bg-[rgb(var(--wb-color-bg-surface))] text-[rgb(var(--wb-color-text-primary))] shadow-sm'
            : 'text-[rgb(var(--wb-color-text-secondary))] hover:text-[rgb(var(--wb-color-text-primary))]',
        )}
      >
        Library
      </button>
      <button
        type="button"
        title="Templates"
        onClick={() => (panelOpen ? setActiveTab('templates') : openTab('templates'))}
        className={cn(
          'h-7 flex-1 rounded-[5px] px-3 text-xs font-semibold transition-colors',
          activeTab === 'templates'
            ? 'bg-[rgb(var(--wb-color-bg-surface))] text-[rgb(var(--wb-color-text-primary))] shadow-sm'
            : 'text-[rgb(var(--wb-color-text-secondary))] hover:text-[rgb(var(--wb-color-text-primary))]',
        )}
      >
        Templates
      </button>
    </div>
  );

  // ── Render (always overlays canvas — never takes layout width) ────────────

  return (
    <div className="pointer-events-none absolute left-3 top-3 z-20 flex max-h-[calc(100%-1.5rem)] w-[220px] flex-col gap-2">
      <div className="pointer-events-auto shrink-0 shadow-[0_2px_8px_rgba(0,0,0,0.08)]">
        {tabToggle}
      </div>

      {panelOpen ? (
        <div
          id="sidebar-panel"
          className="pointer-events-auto flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-[rgb(var(--wb-color-border-subtle))] bg-[rgb(var(--wb-color-bg-surface))] shadow-[0_8px_24px_rgba(0,0,0,0.14)]"
        >
          <div className="flex shrink-0 items-center gap-1 px-2.5 pb-2 pt-2">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-[rgb(var(--wb-color-text-muted))]" />
              <input
                type="text"
                placeholder={activeTab === 'library' ? 'Search…' : 'Filter…'}
                className={cn(searchInputClass, activeTab === 'templates' && 'pr-14')}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {activeTab === 'templates' ? (
                <button
                  type="button"
                  onClick={fetchTemplates}
                  className="absolute right-1 top-1 rounded-md p-1 text-[rgb(var(--wb-color-text-muted))] transition hover:bg-[rgb(var(--wb-color-bg-surface-hover))] hover:text-[rgb(var(--wb-color-text-primary))]"
                  title="Refresh"
                >
                  <RefreshCw size={12} className={templatesLoading ? 'animate-spin' : ''} />
                </button>
              ) : null}
            </div>
            <button
              type="button"
              title="Collapse panel"
              onClick={() => setPanelOpen(false)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[rgb(var(--wb-color-text-muted))] transition-colors hover:bg-[rgb(var(--wb-color-bg-surface-hover))] hover:text-[rgb(var(--wb-color-text-primary))]"
            >
              <ChevronLeft size={14} />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-2.5 pb-4 custom-scrollbar">
            {activeTab === 'library' && (
              <>
                {f(primitives).length > 0 && (
                  <div>
                    <SectionLabel label="Primitives" />
                    <div className="space-y-1">
                      {f(primitives).map(item => <NodeCard key={item.label} item={item} type="custom" />)}
                    </div>
                  </div>
                )}
                {f(flowControl).length > 0 && (
                  <div>
                    <SectionLabel label="Flow Control" />
                    <div className="space-y-1">
                      {f(flowControl).map(item => <NodeCard key={item.label} item={item} type="custom" />)}
                    </div>
                  </div>
                )}
                {f(patterns).length > 0 && (
                  <div>
                    <SectionLabel label="Patterns" />
                    <div className="space-y-1">
                      {f(patterns).map(item => <PatternCard key={item.label} item={item} />)}
                    </div>
                  </div>
                )}
                {f(primitives).length === 0 && f(flowControl).length === 0 && f(patterns).length === 0 && (
                  <p className="py-6 text-center text-[11px] text-[rgb(var(--wb-color-text-muted))]">No results for "{search}"</p>
                )}
              </>
            )}

            {activeTab === 'templates' && (
              <>
                {templatesLoading && (
                  <div className="flex flex-col items-center gap-2 py-8 text-[rgb(var(--wb-color-text-muted))]">
                    <Loader2 size={20} className="animate-spin" />
                    <span className="text-[11px]">Connecting…</span>
                  </div>
                )}
                {!templatesLoading && templatesError && (
                  <div className="mx-0.5 mt-2 flex flex-col items-center gap-2 rounded-xl border border-[rgb(var(--wb-color-border-subtle)/0.3)] bg-[rgb(var(--wb-color-status-warning)/0.08)] p-3 text-center">
                    <AlertCircle size={18} className="text-[rgb(var(--wb-color-status-warning))]" />
                    <p className="text-[11px] font-semibold text-[rgb(var(--wb-color-text-primary))]">Templates Unavailable</p>
                    <p className="text-[10px] text-[rgb(var(--wb-color-text-secondary))]">{templatesError}</p>
                    <button onClick={fetchTemplates} className="text-[11px] font-medium text-[rgb(var(--wb-color-status-warning))] underline hover:no-underline">
                      Retry
                    </button>
                  </div>
                )}
                {!templatesLoading && !templatesError && filteredTemplates.length === 0 && (
                  <div className="flex flex-col items-center gap-2 py-8 text-[rgb(var(--wb-color-text-muted))]">
                    <LayoutTemplate size={20} />
                    <p className="text-[11px] text-center">No remote templates found.</p>
                  </div>
                )}
                {!templatesLoading && !templatesError && filteredTemplates.length > 0 && (
                  <div>
                    <SectionLabel label={`Remote (${filteredTemplates.length})`} />
                    <div className="space-y-1">
                      {filteredTemplates.map(t => <TemplateCard key={t.metadata.name} tmpl={t} />)}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Sidebar;
