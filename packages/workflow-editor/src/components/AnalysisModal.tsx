import React from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Button, Dialog } from '@argocanvas/ui-platform';

interface AnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  result: string | null;
  isLoading: boolean;
}

const AnalysisModal: React.FC<AnalysisModalProps> = ({ isOpen, onClose, result, isLoading }) => (
  <Dialog
    open={isOpen}
    onClose={onClose}
    fullScreenOnMobile
    className="w-[min(100%,48rem)] md:max-h-[min(90vh,920px)] md:min-h-[min(70vh,720px)] max-md:h-full max-md:w-full max-md:max-w-none max-md:rounded-none"
    title={
      <span className="flex items-center gap-3">
        <Sparkles size={18} />
        Workflow Analysis
      </span>
    }
    footer={<Button onClick={onClose}>Close Report</Button>}
  >
    {isLoading ? (
      <div className="flex min-h-[280px] flex-col items-center justify-center gap-4">
        <Loader2 size={40} className="animate-spin text-[rgb(var(--wb-color-accent-primary))]" />
        <p className="text-sm text-[rgb(var(--wb-color-text-secondary))]">
          Thinking deeply about your workflow...
        </p>
      </div>
    ) : (
      <div className="whitespace-pre-wrap text-sm leading-7 text-[rgb(var(--wb-color-text-primary))]">
        {result}
      </div>
    )}
  </Dialog>
);

export default AnalysisModal;
