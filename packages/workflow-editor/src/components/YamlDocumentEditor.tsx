import { useEffect, useMemo, useRef, useState } from "react";
import Editor, { useMonaco } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import { Check, Copy, Download, Edit2, Info, Save, WandSparkles, X } from "lucide-react";
import { PlatformStatusBadge, usePlatformTheme } from "@argocanvas/ui-platform";
import { ensureMonacoYaml } from "../yaml/monacoYaml";

type FeedbackTone = "success" | "warning" | "danger" | "info";

type FeedbackState = {
  tone: FeedbackTone;
  message: string;
};

type YamlDocumentEditorProps = {
  title: string;
  value: string;
  path: string;
  documentId?: string;
  readOnly?: boolean;
  compact?: boolean;
  schemaLabel?: string;
  helpText?: string;
  applyLabel?: string;
  applySuccessMessage?: string;
  downloadFileName?: string;
  onApply?: (value: string) => Promise<void> | void;
  onClose?: () => void;
};

type MonacoMarker = {
  message: string;
  severity: number;
  startLineNumber: number;
  startColumn: number;
};

const messageToneClasses: Record<FeedbackTone, string> = {
  success:
    "border-[rgba(34,197,94,0.28)] bg-[rgba(34,197,94,0.12)] text-[rgb(var(--wb-color-status-success))]",
  warning:
    "border-[rgba(245,158,11,0.28)] bg-[rgba(245,158,11,0.12)] text-[rgb(var(--wb-color-status-warning))]",
  danger:
    "border-[rgba(239,68,68,0.28)] bg-[rgba(239,68,68,0.12)] text-[rgb(var(--wb-color-status-error))]",
  info:
    "border-[rgb(var(--wb-color-border-strong)/0.5)] bg-[rgb(var(--wb-color-bg-surface-hover))] text-[rgb(var(--wb-color-text-secondary))]",
};

export function YamlDocumentEditor(props: YamlDocumentEditorProps) {
  // A draft belongs to its source document. Changing documents must not carry
  // an unapplied edit into the next workflow or template's Apply callback.
  return <YamlDocumentEditorContent key={props.documentId ?? props.path} {...props} />;
}

function YamlDocumentEditorContent(props: YamlDocumentEditorProps) {
  const monaco = useMonaco();
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const { theme } = usePlatformTheme();
  const editorTheme = theme === "dark" ? "vs-dark" : "vs-light";
  const [draftValue, setDraftValue] = useState(props.value);
  const [isEditing, setIsEditing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [markers, setMarkers] = useState<MonacoMarker[]>([]);

  useEffect(() => {
    if (!isEditing) {
      setDraftValue(props.value);
    }
  }, [isEditing, props.value]);

  useEffect(() => {
    if (!monaco) {
      return;
    }

    const updateMarkers = () => {
      const model = monaco.editor.getModel(monaco.Uri.parse(props.path));
      if (!model) {
        setMarkers([]);
        return;
      }
      setMarkers(monaco.editor.getModelMarkers({ resource: model.uri }));
    };

    updateMarkers();
    const subscription = monaco.editor.onDidChangeMarkers((resources) => {
      if (resources.some((resource) => resource.toString() === props.path)) {
        updateMarkers();
      }
    });

    return () => {
      subscription.dispose();
    };
  }, [monaco, props.path]);

  const markerSummary = useMemo(() => {
    if (!monaco) {
      return { errors: 0, warnings: 0, infos: 0 };
    }

    return markers.reduce(
      (summary, marker) => {
        if (marker.severity === monaco.MarkerSeverity.Error) {
          summary.errors += 1;
        } else if (marker.severity === monaco.MarkerSeverity.Warning) {
          summary.warnings += 1;
        } else {
          summary.infos += 1;
        }
        return summary;
      },
      { errors: 0, warnings: 0, infos: 0 },
    );
  }, [markers, monaco]);

  const detailMarkers = useMemo(
    () =>
      [...markers]
        .sort((left, right) =>
          left.startLineNumber === right.startLineNumber
            ? left.startColumn - right.startColumn
            : left.startLineNumber - right.startLineNumber,
        )
        .slice(0, 5),
    [markers],
  );

  const canEdit = !props.readOnly && Boolean(props.onApply);
  const canApply =
    Boolean(props.onApply) &&
    draftValue !== props.value &&
    markerSummary.errors === 0 &&
    !isApplying;
  const currentValue = isEditing ? draftValue : props.value;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(currentValue);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      setFeedback({
        tone: "danger",
        message:
          error instanceof Error ? error.message : "Copy to clipboard is not available.",
      });
    }
  };

  const handleDownload = () => {
    const blob = new Blob([currentValue], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = props.downloadFileName || "manifest.yaml";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const handleApply = async () => {
    if (!props.onApply) {
      return;
    }

    setIsApplying(true);
    setFeedback(null);
    try {
      await props.onApply(draftValue);
      setFeedback({
        tone: "success",
        message: props.applySuccessMessage || "YAML changes applied successfully.",
      });
      setIsEditing(false);
    } catch (error) {
      setFeedback({
        tone: "danger",
        message:
          error instanceof Error ? error.message : "Failed to apply YAML changes.",
      });
    } finally {
      setIsApplying(false);
    }
  };

  const handleCancel = () => {
    setDraftValue(props.value);
    setFeedback(null);
    setIsEditing(false);
  };

  const handleFormat = async () => {
    await editorRef.current?.getAction("editor.action.formatDocument")?.run();
  };

  const validationTone: FeedbackTone =
    markerSummary.errors > 0
      ? "danger"
      : markerSummary.warnings > 0
        ? "warning"
        : "success";

  return (
    <div
      className={`flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[rgb(var(--wb-color-border-subtle)/0.7)] bg-[rgb(var(--wb-color-bg-surface))] ${
        props.compact ? "" : "shadow-[0_18px_32px_rgba(15,23,42,0.08)]"
      }`}
    >
      <div className="border-b border-[rgb(var(--wb-color-border-subtle)/0.65)] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-[rgb(var(--wb-color-text-primary))]">
                {props.title}
              </h3>
              <PlatformStatusBadge tone={isEditing ? "warning" : "info"}>
                {isEditing ? "Editing" : "Read only"}
              </PlatformStatusBadge>
              {props.schemaLabel ? (
                <PlatformStatusBadge tone={validationTone}>
                  {props.schemaLabel}
                </PlatformStatusBadge>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[rgb(var(--wb-color-text-secondary))]">
              <PlatformStatusBadge tone={markerSummary.errors > 0 ? "danger" : "success"}>
                {markerSummary.errors} errors
              </PlatformStatusBadge>
              <PlatformStatusBadge tone={markerSummary.warnings > 0 ? "warning" : "default"}>
                {markerSummary.warnings} warnings
              </PlatformStatusBadge>
              {props.helpText ? <span>{props.helpText}</span> : null}
              {canEdit && isEditing ? (
                <span>Autocomplete: `Ctrl+Space` • Format: `Shift+Alt+F`</span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isEditing ? (
              <>
                <button
                  type="button"
                  onClick={() => void handleFormat()}
                  className="inline-flex items-center gap-2 rounded-lg border border-[rgb(var(--wb-color-border-strong))] px-3 py-2 text-sm text-[rgb(var(--wb-color-text-primary))]"
                >
                  <WandSparkles size={14} />
                  Format
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="rounded-lg border border-[rgb(var(--wb-color-border-strong))] px-3 py-2 text-sm text-[rgb(var(--wb-color-text-primary))]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleApply()}
                  disabled={!canApply}
                  className="inline-flex items-center gap-2 rounded-lg bg-[rgb(var(--wb-color-accent-primary))] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  <Save size={14} />
                  {isApplying ? "Applying…" : props.applyLabel || "Apply"}
                </button>
              </>
            ) : canEdit ? (
              <button
                type="button"
                onClick={() => {
                  setFeedback(null);
                  setIsEditing(true);
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-[rgb(var(--wb-color-border-strong))] px-3 py-2 text-sm text-[rgb(var(--wb-color-text-primary))]"
              >
                <Edit2 size={14} />
                Edit
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => void handleCopy()}
              className="inline-flex items-center gap-2 rounded-lg border border-[rgb(var(--wb-color-border-strong))] px-3 py-2 text-sm text-[rgb(var(--wb-color-text-primary))]"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-2 rounded-lg border border-[rgb(var(--wb-color-border-strong))] px-3 py-2 text-sm text-[rgb(var(--wb-color-text-primary))]"
            >
              <Download size={14} />
              Download
            </button>
            {props.onClose ? (
              <button
                type="button"
                onClick={props.onClose}
                className="rounded-lg border border-[rgb(var(--wb-color-border-strong))] p-2 text-[rgb(var(--wb-color-text-primary))]"
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {feedback ? (
        <div className="border-b border-[rgb(var(--wb-color-border-subtle)/0.65)] px-4 py-3">
          <div
            className={`rounded-xl border px-3 py-2 text-sm ${messageToneClasses[feedback.tone]}`}
          >
            {feedback.message}
          </div>
        </div>
      ) : null}

      {detailMarkers.length > 0 ? (
        <div className="border-b border-[rgb(var(--wb-color-border-subtle)/0.65)] px-4 py-3">
          <div
            className={`rounded-xl border px-3 py-3 text-sm ${
              markerSummary.errors > 0
                ? messageToneClasses.danger
                : messageToneClasses.warning
            }`}
          >
            <div className="flex items-center gap-2 font-semibold">
              <Info size={14} />
              {markerSummary.errors > 0
                ? "Resolve YAML errors before applying changes."
                : "Review YAML warnings before applying changes."}
            </div>
            <ul className="mt-2 space-y-1 text-xs leading-6">
              {detailMarkers.map((marker, index) => (
                <li key={`${marker.message}-${marker.startLineNumber}-${index}`}>
                  Line {marker.startLineNumber}, col {marker.startColumn}: {marker.message}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : canEdit && !isEditing ? (
        <div className="border-b border-[rgb(var(--wb-color-border-subtle)/0.65)] px-4 py-3">
          <div className={`rounded-xl border px-3 py-2 text-sm ${messageToneClasses.success}`}>
            YAML is valid and ready for edits. Use Edit to switch into autocomplete and validation mode.
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden bg-[rgb(var(--wb-color-bg-base))]">
        <Editor
          beforeMount={(instance) => {
            ensureMonacoYaml(instance);
          }}
          height="100%"
          language="yaml"
          path={props.path}
          theme={editorTheme}
          value={currentValue}
          onMount={(editor) => {
            editorRef.current = editor;
          }}
          onChange={(nextValue) => {
            if (isEditing) {
              setDraftValue(nextValue || "");
            }
          }}
          options={{
            automaticLayout: true,
            domReadOnly: !isEditing || props.readOnly,
            folding: true,
            formatOnPaste: isEditing,
            formatOnType: isEditing,
            glyphMargin: true,
            lineNumbersMinChars: 3,
            minimap: { enabled: false },
            padding: {
              top: 12,
              bottom: 12,
            },
            quickSuggestions: isEditing,
            readOnly: !isEditing || props.readOnly,
            renderValidationDecorations: "on",
            scrollBeyondLastLine: false,
            snippetSuggestions: "inline",
            suggestOnTriggerCharacters: isEditing,
            tabSize: 2,
            wordWrap: "on",
          }}
        />
      </div>
    </div>
  );
}
