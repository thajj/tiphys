import React from 'react';
import { CopyPlus, FileInput, Replace } from 'lucide-react';
import { Button, Dialog } from '@argocanvas/ui-platform';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onReplace: () => void;
  onNewTab: () => void;
  fileName?: string;
}

const ImportModal: React.FC<ImportModalProps> = ({ isOpen, onClose, onReplace, onNewTab, fileName }) => (
  <Dialog
    open={isOpen}
    onClose={onClose}
    fullScreenOnMobile
    className="w-[min(100%,40rem)]"
    title={
      <span className="flex items-center gap-3">
        <FileInput size={18} />
        Import Workflow
      </span>
    }
  >
    <p className="mb-6 text-sm leading-relaxed text-[rgb(var(--wb-color-text-secondary))]">
      We detected a workflow configuration
      {fileName ? (
        <span className="mx-1.5 font-mono font-semibold text-[rgb(var(--wb-color-text-primary))]">
          {fileName}
        </span>
      ) : null}
      . How would you like to handle this import?
    </p>

    <div className="flex flex-col gap-4">
      <Button
        variant="outline"
        onClick={onNewTab}
        className="h-auto justify-start gap-3 rounded-2xl px-4 py-4 text-left"
      >
        <CopyPlus size={20} className="shrink-0" />
        <span className="flex flex-col">
          <span className="text-sm font-semibold text-[rgb(var(--wb-color-text-primary))]">Open in New Tab</span>
          <span className="text-sm font-normal text-[rgb(var(--wb-color-text-secondary))]">
            Keep your current work and open this workflow in a separate tab.
          </span>
        </span>
      </Button>

      <Button
        variant="outline"
        onClick={onReplace}
        className="h-auto justify-start gap-3 rounded-2xl border-[rgb(var(--wb-color-status-warning)/0.6)] px-4 py-4 text-left text-[rgb(var(--wb-color-status-warning))] hover:border-[rgb(var(--wb-color-status-warning))] hover:bg-[rgb(var(--wb-color-status-warning)/0.08)] hover:text-[rgb(var(--wb-color-status-warning))]"
      >
        <Replace size={20} className="shrink-0" />
        <span className="flex flex-col">
          <span className="text-sm font-semibold">Replace Current</span>
          <span className="text-sm font-normal text-[rgb(var(--wb-color-text-secondary))]">
            Overwrite the current active workflow with the imported data.
          </span>
        </span>
      </Button>
    </div>
  </Dialog>
);

export default ImportModal;
