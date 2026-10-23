import React, { memo, useLayoutEffect } from 'react';
import { Handle, Position, NodeProps, useReactFlow, useUpdateNodeInternals } from 'reactflow';
import {
  Box, FileJson, CheckCircle2, XCircle, Clock,
  PauseCircle, Database, Globe, Layers, Split, Repeat,
  ChevronDown, ChevronRight, GitBranch
} from 'lucide-react';
import type { FlowNodeData } from '@argocanvas/workflow-domain';

const StatusIcon = ({ status }: { status: string }) => {
  switch (status) {
    case 'Running': return <Clock className="h-3.5 w-3.5 animate-pulse text-[rgb(var(--wb-color-status-info))]" />;
    case 'Succeeded': return <CheckCircle2 className="h-3.5 w-3.5 text-[rgb(var(--wb-color-status-success))]" />;
    case 'Failed': return <XCircle className="h-3.5 w-3.5 text-[rgb(var(--wb-color-status-error))]" />;
    default: return null;
  }
};

const NodeIcon = ({ type }: { type: string }) => {
  switch (type) {
    case 'script': return <FileJson size={16} />;
    case 'resource': return <Database size={16} />;
    case 'suspend': return <PauseCircle size={16} />;
    case 'http': return <Globe size={16} />;
    case 'container-set': return <Layers size={16} />;
    case 'sub-workflow': return <GitBranch size={16} />;
    default: return <Box size={16} />;
  }
};

/** Solid icon tiles — n8n-style colored node badges */
const NodeIconTone = ({ type }: { type: string }) => {
  switch (type) {
    case 'script': return 'bg-[#9b6dd5] text-white';
    case 'resource': return 'bg-[#ff965a] text-white';
    case 'suspend': return 'bg-[#7d7d87] text-white';
    case 'http': return 'bg-[#5fabf7] text-white';
    case 'container-set': return 'bg-[#3a42e9] text-white';
    case 'sub-workflow': return 'bg-[#2fb67c] text-white';
    default: return 'bg-[#ff6d5a] text-white';
  }
};

const CustomNode = ({ id, data, selected, targetPosition = Position.Left, sourcePosition = Position.Right }: NodeProps<FlowNodeData>) => {
  const { setNodes, getEdges } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();

  useLayoutEffect(() => {
    updateNodeInternals(id);
  }, [targetPosition, sourcePosition, id, updateNodeInternals]);

  const iconTone = NodeIconTone({ type: data.type });
  const isConditional = !!data.flowControl?.when;
  const isLoop = !!data.flowControl?.loop?.value;
  const displayImage = data.container?.image;

  const edges = getEdges();
  const hasChildren = edges.some(e => e.source === id);

  const toggleCollapse = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNodes(nodes => nodes.map(n => {
      if (n.id === id) {
        return { ...n, data: { ...n.data, collapsed: !n.data.collapsed } };
      }
      return n;
    }));
  };

  const handleClass =
    '!h-3 !w-3 !rounded-full !border-2 !border-[rgb(var(--wb-color-bg-surface))] !bg-[rgb(var(--wb-color-border-strong))] transition-colors hover:!bg-[rgb(var(--wb-color-accent-primary))] hover:!border-[rgb(var(--wb-color-bg-surface))] cursor-crosshair z-10';

  return (
    <div
      className={`
        group relative w-[220px] rounded-md border bg-[rgb(var(--wb-color-bg-surface))] shadow-[0_2px_6px_rgba(0,0,0,0.08)] transition-shadow
        ${selected
          ? 'border-[rgb(var(--wb-color-accent-primary))] shadow-[0_0_0_1px_rgb(var(--wb-color-accent-primary)),0_4px_14px_rgba(37,99,235,0.18)]'
          : 'border-[rgb(var(--wb-color-border-subtle))] hover:shadow-[0_4px_12px_rgba(0,0,0,0.1)]'}
      `}
    >
      <Handle
        type="target"
        position={targetPosition}
        className={handleClass}
      />

      {(isConditional || isLoop) && (
        <div className="absolute -top-2.5 right-2 flex gap-1">
          {isConditional && (
            <div className="rounded border border-[rgb(var(--wb-color-border-subtle))] bg-[rgb(var(--wb-color-bg-surface))] p-0.5 text-[rgb(var(--wb-color-status-warning))] shadow-sm" title={`Condition: ${data.flowControl?.when}`}>
              <Split size={11} />
            </div>
          )}
          {isLoop && (
            <div className="rounded border border-[rgb(var(--wb-color-border-subtle))] bg-[rgb(var(--wb-color-bg-surface))] p-0.5 text-[#3a42e9] shadow-sm" title="Loop Strategy Active">
              <Repeat size={11} />
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2.5 px-2.5 py-2">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded ${iconTone}`}>
          <NodeIcon type={data.type} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13px] font-medium leading-tight text-[rgb(var(--wb-color-text-primary))]" title={data.label}>
            {data.label}
          </h3>
          <p className="truncate text-[11px] capitalize leading-tight text-[rgb(var(--wb-color-text-muted))]">
            {data.type.replace(/-/g, ' ')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <StatusIcon status={data.status} />
          {hasChildren && (
            <button
              onClick={toggleCollapse}
              className="rounded p-0.5 text-[rgb(var(--wb-color-text-muted))] transition-colors hover:bg-[rgb(var(--wb-color-bg-surface-hover))] hover:text-[rgb(var(--wb-color-text-primary))]"
              title={data.collapsed ? "Expand children" : "Collapse children"}
            >
              {data.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            </button>
          )}
        </div>
      </div>

      {(displayImage || data.type === 'http' || data.type === 'sub-workflow' || data.type === 'suspend') && (
        <div className="border-t border-[rgb(var(--wb-color-border-subtle))] px-2.5 py-1.5 text-[11px] text-[rgb(var(--wb-color-text-secondary))]">
          {(data.type === 'container' || data.type === 'script') && displayImage && (
            <span className="block truncate font-mono text-[10px]" title={displayImage}>{displayImage}</span>
          )}
          {data.type === 'http' && data.http && (
            <span className="flex items-center gap-1.5 truncate">
              <span className="rounded bg-[rgb(var(--wb-color-bg-surface-active))] px-1 py-px text-[9px] font-bold">
                {data.http.method}
              </span>
              <span className="truncate font-mono text-[10px]">{data.http.url}</span>
            </span>
          )}
          {data.type === 'sub-workflow' && data.subWorkflow && (
            <span className="block truncate font-mono text-[10px]">
              {data.subWorkflow.workflowName || data.subWorkflow.workflowId || 'Select workflow…'}
            </span>
          )}
          {data.type === 'suspend' && (
            <span className="font-mono text-[10px]">{data.suspend?.duration || 'Forever'}</span>
          )}
        </div>
      )}

      <Handle
        type="source"
        position={sourcePosition}
        className={handleClass}
      />
    </div>
  );
};

export default memo(CustomNode);
