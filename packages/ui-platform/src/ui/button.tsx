import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

const BASE_BUTTON_CLASSES =
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--wb-color-accent-primary)/0.45)] disabled:pointer-events-none disabled:opacity-50";

const VARIANT_CLASSES = {
  default:
    "bg-[rgb(var(--wb-color-accent-primary))] text-white hover:bg-[rgb(var(--wb-color-accent-primary-hover))]",
  outline:
    "border border-[rgb(var(--wb-color-border-subtle))] bg-[rgb(var(--wb-color-bg-surface))] text-[rgb(var(--wb-color-text-secondary))] hover:border-[rgb(var(--wb-color-border-strong))] hover:bg-[rgb(var(--wb-color-bg-surface-hover))] hover:text-[rgb(var(--wb-color-text-primary))]",
  ghost:
    "text-[rgb(var(--wb-color-text-secondary))] hover:bg-[rgb(var(--wb-color-bg-surface-hover))] hover:text-[rgb(var(--wb-color-text-primary))]",
  danger:
    "bg-[rgb(var(--wb-color-status-error))] text-white hover:bg-[rgb(var(--wb-color-status-error)/0.9)]",
  warning:
    "bg-[rgb(var(--wb-color-status-warning))] text-white hover:bg-[rgb(var(--wb-color-status-warning)/0.9)]",
} as const;

const SIZE_CLASSES = {
  default: "h-9 px-3.5 py-2",
  sm: "h-8 px-2.5 text-xs",
  icon: "h-9 w-9 p-0",
  "icon-sm": "h-8 w-8 p-0",
} as const;

export type ButtonVariant = keyof typeof VARIANT_CLASSES;
export type ButtonSize = keyof typeof SIZE_CLASSES;

export function buttonVariants(options?: {
  variant?: ButtonVariant | null;
  size?: ButtonSize | null;
  className?: string;
}) {
  const variant = options?.variant ?? "default";
  const size = options?.size ?? "default";
  return cn(
    BASE_BUTTON_CLASSES,
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    options?.className,
  );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant | null;
  size?: ButtonSize | null;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  ),
);
Button.displayName = "Button";
