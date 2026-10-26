import React, { useEffect, useState } from 'react';
import { Clock, Save, Settings as SettingsIcon, Shield, Trash2 } from 'lucide-react';
import { Button, Dialog, cn } from '@tiphys/ui-platform';
import type { WorkflowMetadata, WorkflowSpec } from '@tiphys/workflow-domain';
import { SelectField, TextField } from './formFields';

interface WorkflowSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  metadata: WorkflowMetadata;
  spec: WorkflowSpec;
  onSave: (meta: WorkflowMetadata, spec: WorkflowSpec) => void;
}

const parseOptionalNumber = (value: string) => {
  if (value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const sectionClassName = 'grid gap-4';
const sectionTitleClassName = 'text-sm font-semibold text-[rgb(var(--wb-color-text-primary))]';

const WorkflowSettings: React.FC<WorkflowSettingsProps> = ({ isOpen, onClose, metadata, spec, onSave }) => {
  const [localMeta, setLocalMeta] = useState(metadata);
  const [localSpec, setLocalSpec] = useState(spec);
  const [activeTab, setActiveTab] = useState<'basic' | 'lifecycle' | 'security'>('basic');

  useEffect(() => {
    if (isOpen) {
      setLocalMeta(metadata);
      setLocalSpec(spec);
    }
  }, [isOpen, metadata, spec]);

  const handleSave = () => {
    onSave(localMeta, localSpec);
    onClose();
  };

  const updateSpec = (path: string[], value: unknown) => {
    const nextSpec = JSON.parse(JSON.stringify(localSpec));
    let current = nextSpec;
    for (let index = 0; index < path.length - 1; index += 1) {
      if (!current[path[index]]) current[path[index]] = {};
      current = current[path[index]];
    }
    current[path[path.length - 1]] = value;
    setLocalSpec(nextSpec);
  };

  const tabs = [
    { value: 'basic', label: 'General', icon: null },
    { value: 'lifecycle', label: 'Lifecycle & GC', icon: <Clock size={14} /> },
    { value: 'security', label: 'Security', icon: <Shield size={14} /> },
  ] as const;

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      fullScreenOnMobile
      className="w-[min(100%,48rem)] max-h-[min(92vh,960px)] max-md:max-h-none"
      contentClassName="p-0"
      title={
        <span className="flex items-center gap-3">
          <SettingsIcon size={18} />
          Workflow Settings
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            <Save size={16} />
            Save Changes
          </Button>
        </>
      }
    >
      <div
        role="tablist"
        className="flex gap-1 overflow-x-auto border-b border-[rgb(var(--wb-color-border-subtle)/0.8)] px-4"
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.value)}
              className={cn(
                'flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--wb-color-accent-primary)/0.45)]',
                isActive
                  ? 'border-[rgb(var(--wb-color-accent-primary))] text-[rgb(var(--wb-color-accent-primary))]'
                  : 'border-transparent text-[rgb(var(--wb-color-text-secondary))] hover:text-[rgb(var(--wb-color-text-primary))]',
              )}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className="px-5 py-6">
        {activeTab === 'basic' && (
          <div className="flex flex-col gap-6">
            <section className={sectionClassName}>
              <h3 className={sectionTitleClassName}>Metadata</h3>
              <div className="flex flex-col gap-4">
                <TextField
                  label="Name (Generate Prefix)"
                  value={localMeta.name}
                  onChange={(event) => setLocalMeta({ ...localMeta, name: event.target.value })}
                />
                <TextField
                  label="Namespace"
                  value={localMeta.namespace}
                  onChange={(event) => setLocalMeta({ ...localMeta, namespace: event.target.value })}
                />
              </div>
            </section>

            <section className={sectionClassName}>
              <h3 className={sectionTitleClassName}>Global Config</h3>
              <div className="flex flex-col gap-4">
                <TextField
                  label="Entrypoint Template"
                  value={localSpec.entrypoint || 'main'}
                  onChange={(event) => updateSpec(['entrypoint'], event.target.value)}
                  helperText="The name of the main DAG template."
                />
                <TextField
                  label="Active Deadline (Seconds)"
                  type="number"
                  value={localSpec.activeDeadlineSeconds ?? ''}
                  onChange={(event) => updateSpec(['activeDeadlineSeconds'], parseOptionalNumber(event.target.value))}
                  placeholder="3600"
                />
                <TextField
                  label="Max Parallelism"
                  type="number"
                  value={localSpec.parallelism ?? ''}
                  onChange={(event) => updateSpec(['parallelism'], parseOptionalNumber(event.target.value))}
                  placeholder="10"
                />
              </div>
            </section>
          </div>
        )}

        {activeTab === 'lifecycle' && (
          <div className="flex flex-col gap-6">
            <section className={sectionClassName}>
              <h3 className={sectionTitleClassName}>Pod Garbage Collection</h3>
              <div className="flex flex-col gap-4">
                <SelectField
                  label="Strategy"
                  value={localSpec.podGC?.strategy || ''}
                  onChange={(event) => updateSpec(['podGC', 'strategy'], event.target.value)}
                >
                  <option value="">Disable GC</option>
                  <option value="OnPodCompletion">OnPodCompletion</option>
                  <option value="OnPodSuccess">OnPodSuccess</option>
                  <option value="OnFailure">OnFailure</option>
                </SelectField>
                <TextField
                  label="Delete Delay"
                  value={localSpec.podGC?.deleteDelayDuration || ''}
                  onChange={(event) => updateSpec(['podGC', 'deleteDelayDuration'], event.target.value)}
                  placeholder="60s"
                />
              </div>
            </section>

            <section className={sectionClassName}>
              <h3 className={sectionTitleClassName}>TTL Strategy</h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <TextField
                  label="After Complete"
                  type="number"
                  value={localSpec.ttlStrategy?.secondsAfterCompletion ?? ''}
                  onChange={(event) =>
                    updateSpec(['ttlStrategy', 'secondsAfterCompletion'], parseOptionalNumber(event.target.value))
                  }
                  placeholder="Seconds"
                />
                <TextField
                  label="After Success"
                  type="number"
                  value={localSpec.ttlStrategy?.secondsAfterSuccess ?? ''}
                  onChange={(event) =>
                    updateSpec(['ttlStrategy', 'secondsAfterSuccess'], parseOptionalNumber(event.target.value))
                  }
                  placeholder="Seconds"
                />
                <TextField
                  label="After Failure"
                  type="number"
                  value={localSpec.ttlStrategy?.secondsAfterFailure ?? ''}
                  onChange={(event) =>
                    updateSpec(['ttlStrategy', 'secondsAfterFailure'], parseOptionalNumber(event.target.value))
                  }
                  placeholder="Seconds"
                />
              </div>
            </section>
          </div>
        )}

        {activeTab === 'security' && (
          <div className="flex flex-col gap-6">
            <section className={sectionClassName}>
              <TextField
                label="Service Account Name"
                value={localSpec.serviceAccountName || ''}
                onChange={(event) => updateSpec(['serviceAccountName'], event.target.value)}
                placeholder="default"
              />
            </section>

            <section className={sectionClassName}>
              <div className="flex items-center justify-between gap-3">
                <h3 className={sectionTitleClassName}>Image Pull Secrets</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const secrets = localSpec.imagePullSecrets || [];
                    updateSpec(['imagePullSecrets'], [...secrets, { name: '' }]);
                  }}
                >
                  Add Secret
                </Button>
              </div>

              <div className="flex flex-col gap-3">
                {(localSpec.imagePullSecrets || []).map((secret, index) => (
                  <div key={`${secret.name}-${index}`} className="flex items-end gap-2">
                    <TextField
                      label={`Secret ${index + 1}`}
                      wrapperClassName="flex-1"
                      value={secret.name}
                      onChange={(event) => {
                        const secrets = [...(localSpec.imagePullSecrets || [])];
                        secrets[index].name = event.target.value;
                        updateSpec(['imagePullSecrets'], secrets);
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove secret ${index + 1}`}
                      className="text-[rgb(var(--wb-color-status-error))] hover:bg-[rgb(var(--wb-color-status-error)/0.12)] hover:text-[rgb(var(--wb-color-status-error))]"
                      onClick={() => {
                        const secrets = localSpec.imagePullSecrets?.filter((_, secretIndex) => secretIndex !== index);
                        updateSpec(['imagePullSecrets'], secrets);
                      }}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                ))}

                {(localSpec.imagePullSecrets?.length || 0) === 0 && (
                  <p className="text-sm text-[rgb(var(--wb-color-text-secondary))]">
                    No image pull secrets defined.
                  </p>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </Dialog>
  );
};

export default WorkflowSettings;
