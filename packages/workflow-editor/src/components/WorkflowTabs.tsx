import React, { useEffect, useRef, useState } from 'react';
import { Copy, Plus, X, FileCode } from 'lucide-react';
import { Button, Tooltip, cn } from '@tiphys/ui-platform';
import type { WorkflowSession } from '@tiphys/workflow-domain';

interface WorkflowTabsProps {
  sessions: WorkflowSession[];
  activeSessionId: string;
  onSwitch: (id: string) => void;
  onClose: (id: string, e: React.MouseEvent) => void;
  onAdd: () => void;
  onDuplicate?: () => void;
  onRename: (id: string, newName: string) => void;
}

const WorkflowTabs: React.FC<WorkflowTabsProps> = ({ sessions, activeSessionId, onSwitch, onClose, onAdd, onDuplicate, onRename }) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const startEditing = (event: React.MouseEvent, session: WorkflowSession) => {
    event.stopPropagation();
    setEditingId(session.id);
    setEditName(session.name);
  };

  const saveEdit = () => {
    if (editingId && editName.trim()) {
      onRename(editingId, editName.trim());
    }
    setEditingId(null);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') saveEdit();
    if (event.key === 'Escape') setEditingId(null);
  };

  return (
    <div className="flex h-9 items-center gap-2 px-2">
      <div role="tablist" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {sessions.map((session) => {
          const isActive = session.id === activeSessionId;
          const isEditing = editingId === session.id;

          return (
            <div
              key={session.id}
              role="tab"
              tabIndex={0}
              aria-selected={isActive}
              onClick={() => onSwitch(session.id)}
              onDoubleClick={(event) => startEditing(event, session)}
              onKeyDown={(event) => {
                if (isEditing) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSwitch(session.id);
                }
              }}
              className={cn(
                'flex h-7 min-w-28 max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--wb-color-accent-primary)/0.45)]',
                isActive
                  ? 'bg-[rgb(var(--wb-color-bg-surface-active))] text-[rgb(var(--wb-color-text-primary))]'
                  : 'text-[rgb(var(--wb-color-text-secondary))] hover:bg-[rgb(var(--wb-color-bg-surface-hover))] hover:text-[rgb(var(--wb-color-text-primary))]',
              )}
            >
              <FileCode size={14} className="shrink-0" />
              {isEditing ? (
                <input
                  ref={inputRef}
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  onBlur={saveEdit}
                  onKeyDown={handleKeyDown}
                  onClick={(event) => event.stopPropagation()}
                  className="min-w-[120px] rounded-lg border border-[rgb(var(--wb-color-border-subtle)/0.9)] bg-[rgb(var(--wb-color-bg-base))] px-2 py-1 text-sm text-[rgb(var(--wb-color-text-primary))] focus:border-[rgb(var(--wb-color-accent-primary))] focus:outline-none"
                />
              ) : (
                <span className="truncate">{session.name || 'Untitled'}</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {sessions.length > 1 && (
          <Tooltip label="Close current workflow" side="bottom">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close current workflow"
              onClick={(event) => onClose(activeSessionId, event)}
              className="hover:bg-[rgb(var(--wb-color-status-error)/0.12)] hover:text-[rgb(var(--wb-color-status-error))]"
            >
              <X size={14} />
            </Button>
          </Tooltip>
        )}
        {onDuplicate ? (
          <Tooltip label="Duplicate" side="bottom">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Duplicate"
              title="Duplicate"
              onClick={onDuplicate}
            >
              <Copy size={15} />
            </Button>
          </Tooltip>
        ) : null}
        <Tooltip label="New Workflow" side="bottom">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New workflow"
            title="New Workflow"
            onClick={onAdd}
          >
            <Plus size={16} />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
};

export default WorkflowTabs;
