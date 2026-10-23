import type { PropsWithChildren, ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "./lib/cn";
import { Button } from "./ui/button";
import { Tooltip } from "./ui/tooltip";

export type PlatformRailItem = {
  id: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
  onClick?: () => void;
};

export type PlatformWorkspaceTab = {
  id: string;
  label: string;
  icon?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
};

export type PlatformInspectorTab = {
  id: string;
  label: string;
  icon?: ReactNode;
  hidden?: boolean;
};

export function PlatformPreviewFrame({
  rail,
  topbar,
  children,
}: PropsWithChildren<{
  rail: ReactNode;
  topbar?: ReactNode;
}>) {
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 overflow-hidden text-[rgb(var(--wb-color-text-primary))]">
      <div data-testid="platform-preview-rail" className="flex h-full min-h-0 shrink-0">
        {rail}
      </div>
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {topbar ? (
          <div data-testid="platform-preview-topbar" className="shrink-0">
            {topbar}
          </div>
        ) : null}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

export function PlatformRail(props: {
  brand: ReactNode;
  brandSurface?: "accent" | "plain";
  items: PlatformRailItem[];
  footerItems?: PlatformRailItem[];
}) {
  const renderRailItem = (item: PlatformRailItem) => (
    <Tooltip key={item.id} label={item.label} side="right">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={item.onClick}
        data-testid={`platform-rail-item-${item.id}`}
        aria-label={item.label}
        className={cn(
          "relative h-8 w-8 rounded-md",
          item.active
            ? "bg-[rgb(var(--wb-color-bg-surface-active))] text-[rgb(var(--wb-color-text-primary))] hover:bg-[rgb(var(--wb-color-bg-surface-active))] hover:text-[rgb(var(--wb-color-text-primary))]"
            : "text-[rgb(var(--wb-color-text-secondary))]",
        )}
      >
        {item.active ? (
          <span className="absolute -left-2 top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full bg-[rgb(var(--wb-color-text-primary))]" />
        ) : null}
        {item.icon}
      </Button>
    </Tooltip>
  );

  return (
    <aside className="flex h-full min-h-0 w-12 flex-col items-center overflow-hidden border-r border-[rgb(var(--wb-color-border-subtle))] bg-[rgb(var(--wb-color-bg-surface))]">
      <div
        className={cn(
          "mb-2 mt-2 flex h-7 w-7 items-center justify-center rounded-md",
          props.brandSurface === "plain"
            ? "bg-transparent text-[rgb(var(--wb-color-text-primary))]"
            : "bg-[rgb(var(--wb-color-accent-primary))] text-white",
        )}
      >
        {props.brand}
      </div>

      <nav className="flex min-h-0 w-full flex-1 flex-col items-center gap-0.5">
        {props.items.map(renderRailItem)}
      </nav>

      {props.footerItems && props.footerItems.length > 0 ? (
        <div className="mb-2 flex w-full shrink-0 flex-col items-center gap-0.5">
          {props.footerItems.map(renderRailItem)}
        </div>
      ) : null}
    </aside>
  );
}

export function PlatformTopbar(props: {
  breadcrumbs: ReactNode;
  center?: ReactNode;
  environment?: ReactNode;
  search?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="grid h-12 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-[rgb(var(--wb-color-border-subtle))] bg-[rgb(var(--wb-color-bg-surface))] px-3">
      <div className="flex min-w-0 items-center justify-self-start">{props.breadcrumbs}</div>
      <div className="justify-self-center">{props.center}</div>
      <div className="flex shrink-0 items-center justify-end justify-self-end gap-2">
        {props.environment}
        {props.search}
        {props.actions}
      </div>
    </header>
  );
}

export function PlatformSegmentedTabs(props: { tabs: PlatformWorkspaceTab[] }) {
  return (
    <div
      data-testid="workflow-workspace-tabs"
      role="tablist"
      className="inline-flex h-8 items-center rounded-md border border-[rgb(var(--wb-color-border-subtle))] bg-[rgb(var(--wb-color-bg-base))] p-0.5"
    >
      {props.tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={Boolean(tab.active)}
          disabled={tab.disabled}
          onClick={tab.onClick}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-[5px] px-3 text-xs font-semibold transition-colors disabled:opacity-50",
            tab.active
              ? "bg-[rgb(var(--wb-color-bg-surface))] text-[rgb(var(--wb-color-text-primary))] shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
              : "text-[rgb(var(--wb-color-text-secondary))] hover:text-[rgb(var(--wb-color-text-primary))]",
          )}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

export function PlatformSectionHeader(props: {
  eyebrow?: string;
  icon?: ReactNode;
  iconSurface?: "accent" | "plain";
  title: string;
  subtitle?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="border-b border-[rgb(var(--wb-color-border-subtle))] bg-[rgb(var(--wb-color-bg-surface))]">
      <div className="flex h-12 min-w-0 items-center gap-3 px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          {props.icon ? (
            <div
              className={cn(
                "flex shrink-0 items-center justify-center rounded-md",
                props.iconSurface === "plain"
                  ? "p-0"
                  : "border border-[rgb(var(--wb-color-border-subtle)/0.9)] bg-[rgb(var(--wb-color-accent-primary)/0.08)] p-1 text-[rgb(var(--wb-color-accent-primary))]",
              )}
            >
              {props.icon}
            </div>
          ) : null}
          <div className="min-w-0 flex-1 overflow-hidden">
            {props.eyebrow ? (
              <div className="truncate text-[10px] font-bold uppercase tracking-[0.18em] text-[rgb(var(--wb-color-text-secondary))]">
                {props.eyebrow}
              </div>
            ) : null}
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-base font-semibold tracking-tight">{props.title}</h1>
              {props.meta ? (
                <div className="hidden min-w-0 items-center gap-1.5 text-xs text-[rgb(var(--wb-color-text-secondary))] sm:flex">
                  {props.meta}
                </div>
              ) : null}
            </div>
            {props.subtitle ? (
              <div className="truncate text-xs text-[rgb(var(--wb-color-text-secondary))]">
                {props.subtitle}
              </div>
            ) : null}
          </div>
        </div>
        {props.actions ? (
          <div className="flex shrink-0 items-center gap-1">{props.actions}</div>
        ) : null}
      </div>
      {props.footer ? (
        <div className="border-t border-[rgb(var(--wb-color-border-subtle)/0.82)] px-2">{props.footer}</div>
      ) : null}
    </section>
  );
}

export function PlatformInspectorFrame({
  tabs,
  activeTab,
  onTabChange,
  onClose,
  children,
  width,
  className,
}: PropsWithChildren<{
  tabs: PlatformInspectorTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  onClose?: () => void;
  width?: string | number;
  className?: string;
}>) {
  const visibleTabs = tabs.filter((tab) => !tab.hidden);

  return (
    <aside
      data-testid="workflow-inspector"
      className={cn(
        "flex min-w-0 shrink-0 flex-col overflow-hidden border-l border-[rgb(var(--wb-color-border-subtle))] bg-[rgb(var(--wb-color-bg-surface))] shadow-[-8px_0_20px_rgba(0,0,0,0.06)]",
        className,
      )}
      style={{ width: width ?? "min(100%, 24rem)", maxWidth: "100%" }}
    >
      <div className="flex min-h-14 items-center border-b border-[rgb(var(--wb-color-border-subtle)/0.72)] px-1.5">
        <div className="flex min-h-11 flex-1 gap-0.5 overflow-x-auto">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              id={`inspector-tab-${tab.id}`}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-1.5 text-sm font-semibold transition-colors",
                activeTab === tab.id
                  ? "text-[rgb(var(--wb-color-accent-primary))]"
                  : "text-[rgb(var(--wb-color-text-secondary))] hover:bg-[rgb(var(--wb-color-accent-primary)/0.06)] hover:text-[rgb(var(--wb-color-text-primary))]",
              )}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
        {onClose ? (
          <Tooltip label="Close inspector">
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={onClose}
              className="ml-1 text-[rgb(var(--wb-color-text-secondary))]"
              aria-label="Close inspector"
            >
              <X size={16} />
            </Button>
          </Tooltip>
        ) : null}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
    </aside>
  );
}

const badgeToneClass = {
  default:
    "border-[rgb(var(--wb-color-border-subtle)/0.96)] bg-[rgb(var(--wb-color-text-secondary)/0.08)] text-[rgb(var(--wb-color-text-secondary))]",
  success:
    "border-[rgb(var(--wb-color-status-success)/0.26)] bg-[rgb(var(--wb-color-status-success)/0.12)] text-[rgb(var(--wb-color-status-success))]",
  warning:
    "border-[rgb(var(--wb-color-status-warning)/0.26)] bg-[rgb(var(--wb-color-status-warning)/0.12)] text-[rgb(var(--wb-color-status-warning))]",
  danger:
    "border-[rgb(var(--wb-color-status-error)/0.24)] bg-[rgb(var(--wb-color-status-error)/0.12)] text-[rgb(var(--wb-color-status-error))]",
  info:
    "border-[rgb(var(--wb-color-status-info)/0.24)] bg-[rgb(var(--wb-color-status-info)/0.12)] text-[rgb(var(--wb-color-status-info))]",
} as const;

export function PlatformStatusBadge(props: {
  children: ReactNode;
  tone?: keyof typeof badgeToneClass;
  pulse?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-1.5 py-0.5 text-[11px] font-bold tracking-wide",
        badgeToneClass[props.tone ?? "default"],
        props.pulse && "animate-pulse",
      )}
    >
      {props.children}
    </span>
  );
}

export function PlatformEmptyState(props: {
  icon?: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[rgb(var(--wb-color-border-subtle)/0.96)] bg-[rgb(var(--wb-color-bg-surface)/0.78)] px-4 py-5 text-center">
      {props.icon ? (
        <div className="flex items-center justify-center rounded-xl border border-[rgb(var(--wb-color-border-subtle)/0.9)] bg-[rgb(var(--wb-color-accent-primary)/0.08)] p-2 text-[rgb(var(--wb-color-text-secondary))]">
          {props.icon}
        </div>
      ) : null}
      <div className="max-w-md">
        <h2 className="mb-1 text-lg font-bold tracking-tight">{props.title}</h2>
        <p className="text-sm leading-relaxed text-[rgb(var(--wb-color-text-secondary))]">{props.body}</p>
      </div>
      {props.action}
    </div>
  );
}
