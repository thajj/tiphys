import type { PropsWithChildren, ReactNode } from "react";
import { cn } from "../lib/cn";

type TooltipProps = PropsWithChildren<{
  label: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}>;

const sideClass: Record<NonNullable<TooltipProps["side"]>, string> = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
};

/** Lightweight hover/focus tooltip. Prefer short labels. */
export function Tooltip({ label, side = "top", className, children }: TooltipProps) {
  return (
    <span className={cn("group relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-50 whitespace-nowrap rounded-md border border-[rgb(var(--wb-color-border-subtle)/0.9)] bg-[rgb(var(--wb-color-bg-surface))] px-2 py-1 text-xs font-medium text-[rgb(var(--wb-color-text-primary))] opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
          sideClass[side],
        )}
      >
        {label}
      </span>
    </span>
  );
}
