import React, { useState } from 'react';
import { geminiService } from '../services/geminiService';
import { Loader2, PlayCircle, Sparkles } from 'lucide-react';
import { Button } from '@argocanvas/ui-platform';
import { getWorkflowRuntime } from '../platform/runtime';
import { TextAreaField } from './formFields';

interface AIAssistantProps {
  onGenerate: (yaml: string) => void;
}

const AIAssistant: React.FC<AIAssistantProps> = ({ onGenerate }) => {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canUseAI = getWorkflowRuntime().shell.featureFlags.aiAssistant && getWorkflowRuntime().shell.permissions.canUseAI;

  const handleGenerate = async () => {
    if (!prompt.trim() || !canUseAI) return;

    setLoading(true);
    setError(null);

    try {
      const yamlContent = await geminiService.generateWorkflow(prompt);
      onGenerate(yamlContent);
      setPrompt('');
    } catch {
      setError('Failed to generate workflow through the platform AI gateway. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[rgb(var(--wb-color-bg-surface))]">
      <div className="border-b border-[rgb(var(--wb-color-border-subtle)/0.9)] bg-[rgb(var(--wb-color-bg-base))] px-6 py-6">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgb(var(--wb-color-accent-primary)/0.14)] text-[rgb(var(--wb-color-accent-primary))]">
            <Sparkles size={18} />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight">AI Assistant</h2>
            <p className="text-sm text-[rgb(var(--wb-color-text-secondary))]">
              Generate workflow scaffolding directly from a prompt.
            </p>
          </div>
        </div>
        <p className="text-sm text-[rgb(var(--wb-color-text-secondary))]">
          Describe the workflow you need and the assistant will draft a manifest for the active session.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="flex flex-col gap-5">
          {!canUseAI && (
            <div
              role="alert"
              className="rounded-2xl border border-[rgb(var(--wb-color-status-warning)/0.6)] px-4 py-3 text-sm text-[rgb(var(--wb-color-status-warning))]"
            >
              AI assistance is disabled by the platform for this environment or role.
            </div>
          )}

          <div className="flex items-start gap-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--wb-color-accent-primary)/0.14)] text-[rgb(var(--wb-color-accent-primary))]">
              <Sparkles size={16} />
            </div>
            <div className="max-w-full rounded-2xl rounded-tl-[10px] border border-[rgb(var(--wb-color-border-subtle)/0.9)] bg-[rgb(var(--wb-color-accent-primary)/0.08)] px-4 py-3.5 text-sm">
              Hi. Ask for a pipeline or a data transformation job and I&apos;ll generate a starting
              manifest.
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-2xl border border-[rgb(var(--wb-color-status-error)/0.6)] px-4 py-3 text-sm text-[rgb(var(--wb-color-status-error))]"
            >
              {error}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-[rgb(var(--wb-color-border-subtle)/0.9)] bg-[rgb(var(--wb-color-bg-base))] px-6 py-5">
        <TextAreaField
          label="Describe the workflow"
          rows={4}
          className="max-h-52"
          placeholder="Create a workflow that stages data from GCS, runs a Python transform, and publishes results to BigQuery."
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void handleGenerate();
            }
          }}
        />

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-[rgb(var(--wb-color-text-secondary))]">
            Powered by the internal platform AI gateway
          </span>
          <Button
            onClick={() => {
              void handleGenerate();
            }}
            disabled={loading || !prompt.trim() || !canUseAI}
          >
            {loading ? 'Generating...' : 'Generate Workflow'}
            {loading ? <Loader2 size={16} className="animate-spin" /> : <PlayCircle size={16} />}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AIAssistant;
