import React, { memo, useContext, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, EdgeProps, getSmoothStepPath } from 'reactflow';
import { Database, ArrowRight, X } from 'lucide-react';
import { WorkflowEdgeDeleteContext } from './WorkflowEdge';

const DataEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  selected,
  interactionWidth = 28,
}) => {
  const deleteEdge = useContext(WorkflowEdgeDeleteContext);
  const [isHovered, setIsHovered] = useState(false);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 16,
    offset: 20,
  });

  const isActive = selected || isHovered;

  const edgeStyle = {
    strokeWidth: isActive ? 2.5 : 2,
    stroke: isActive ? 'rgb(var(--wb-color-accent-primary))' : 'rgb(148 163 184)',
    ...style,
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteEdge?.(id);
  };

  return (
    <g
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="group cursor-pointer"
    >
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={edgeStyle}
        interactionWidth={interactionWidth}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            fontSize: 10,
            pointerEvents: 'all',
          }}
          className="nodrag nopan flex items-center gap-1"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <div
            className="flex items-center gap-1 rounded-full border bg-[rgb(var(--wb-color-bg-surface))] px-2 py-1 font-bold shadow-md transition-colors duration-300"
            style={{
              borderColor: edgeStyle.stroke,
              color: edgeStyle.stroke,
              opacity: (style as React.CSSProperties).opacity ?? 1,
            }}
            title="Artifact Data Transfer"
          >
            <Database size={10} />
            <ArrowRight size={8} />
          </div>
          {isActive && deleteEdge && (
            <button
              type="button"
              onClick={handleDelete}
              className="flex h-5 w-5 items-center justify-center rounded-full border border-[rgb(var(--wb-color-border-subtle))] bg-[rgb(var(--wb-color-bg-surface))] text-[rgb(var(--wb-color-text-muted))] shadow-md transition-transform hover:scale-115 hover:border-[rgb(var(--wb-color-status-error))] hover:bg-[rgb(var(--wb-color-status-error))] hover:text-white"
              title="Delete connection"
              aria-label="Delete connection"
            >
              <X size={11} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </g>
  );
};

export default memo(DataEdge);
