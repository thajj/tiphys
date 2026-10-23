import {
  useEffect,
  useId,
  useRef,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "./button";

type DialogProps = PropsWithChildren<{
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
  fullScreenOnMobile?: boolean;
}>;

export function Dialog(props: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (props.open) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [props.open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={props.title ? titleId : undefined}
      aria-describedby={props.description ? descriptionId : undefined}
      onClose={props.onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) props.onClose();
      }}
      className={cn(
        "m-auto w-[min(100%,32rem)] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-[rgb(var(--wb-color-border-subtle)/0.9)] bg-[rgb(var(--wb-color-bg-surface))] p-0 text-[rgb(var(--wb-color-text-primary))] shadow-2xl backdrop:bg-black/45 open:flex open:flex-col",
        props.fullScreenOnMobile && "max-sm:h-full max-sm:w-full max-sm:max-w-none max-sm:rounded-none",
        props.className,
      )}
    >
      {(props.title || props.description) && (
        <div className="flex items-start justify-between gap-3 border-b border-[rgb(var(--wb-color-border-subtle)/0.8)] px-5 py-4">
          <div className="min-w-0">
            {props.title ? (
              <h2 id={titleId} className="text-lg font-bold tracking-tight">{props.title}</h2>
            ) : null}
            {props.description ? (
              <p id={descriptionId} className="mt-1 text-sm leading-relaxed text-[rgb(var(--wb-color-text-secondary))]">
                {props.description}
              </p>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close dialog"
            onClick={props.onClose}
            className="shrink-0"
          >
            <X size={16} />
          </Button>
        </div>
      )}
      <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4", props.contentClassName)}>
        {props.children}
      </div>
      {props.footer ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[rgb(var(--wb-color-border-subtle)/0.8)] px-5 py-3">
          {props.footer}
        </div>
      ) : null}
    </dialog>
  );
}
