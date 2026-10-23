import type { ReactNode } from "react";
import { Button, Dialog } from "@argocanvas/ui-platform";

type ConfirmationDialogProps = {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "warning" | "info";
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmationDialog(props: ConfirmationDialogProps) {
  const confirmVariant =
    props.tone === "danger" ? "danger" : props.tone === "warning" ? "warning" : "default";

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title={props.title}
      footer={
        <>
          <Button type="button" variant="outline" onClick={props.onClose}>
            {props.cancelLabel || "Cancel"}
          </Button>
          <Button type="button" variant={confirmVariant} onClick={props.onConfirm}>
            {props.confirmLabel || "Confirm"}
          </Button>
        </>
      }
    >
      {typeof props.message === "string" ? (
        <p className="text-sm leading-relaxed text-[rgb(var(--wb-color-text-secondary))]">
          {props.message}
        </p>
      ) : (
        props.message
      )}
    </Dialog>
  );
}
