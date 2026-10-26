import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type PropsWithChildren,
} from "react";
import { MoonStar, SunMedium } from "lucide-react";
import { cn } from "./lib/cn";
import { Button } from "./ui/button";
import { Tooltip } from "./ui/tooltip";

export type PlatformTheme = "dark" | "light";

type PlatformThemeContextValue = {
  theme: PlatformTheme;
  setTheme: (theme: PlatformTheme) => void;
  toggleTheme: () => void;
};

type PlatformThemeProviderProps = PropsWithChildren<{
  defaultTheme?: PlatformTheme;
  storageKey?: string;
}>;

export type PlatformThemeConfig = {
  backgroundGradient: string;
  cssVars: Record<`--${string}`, string>;
};

const DEFAULT_STORAGE_KEY = "wb-platform-theme";

export const platformThemeConfig: Record<PlatformTheme, PlatformThemeConfig> = {
  // Neutral editor chrome + Tiphys logo blue (#2563eb).
  dark: {
    backgroundGradient: "none",
    cssVars: {
      "--wb-color-bg-base": "32 32 35",
      "--wb-color-bg-surface": "40 40 43",
      "--wb-color-bg-surface-hover": "50 50 55",
      "--wb-color-bg-surface-active": "58 58 64",
      "--wb-color-border-subtle": "64 64 70",
      "--wb-color-border-strong": "90 90 98",
      "--wb-color-text-primary": "245 245 245",
      "--wb-color-text-secondary": "196 196 204",
      "--wb-color-text-muted": "156 156 163",
      "--wb-color-accent-primary": "37 99 235",
      "--wb-color-accent-primary-hover": "29 78 216",
      "--wb-color-status-success": "47 182 124",
      "--wb-color-status-warning": "245 158 11",
      "--wb-color-status-error": "229 72 77",
      "--wb-color-status-info": "56 189 248",
      "--wb-color-grid-major": "90 90 98",
      "--wb-color-grid-minor": "50 50 55",
    },
  },
  light: {
    backgroundGradient: "none",
    cssVars: {
      "--wb-color-bg-base": "242 242 245",
      "--wb-color-bg-surface": "255 255 255",
      "--wb-color-bg-surface-hover": "247 247 249",
      "--wb-color-bg-surface-active": "238 238 242",
      "--wb-color-border-subtle": "228 228 232",
      "--wb-color-border-strong": "205 205 212",
      "--wb-color-text-primary": "38 38 44",
      "--wb-color-text-secondary": "90 90 98",
      "--wb-color-text-muted": "122 122 132",
      "--wb-color-accent-primary": "37 99 235",
      "--wb-color-accent-primary-hover": "29 78 216",
      "--wb-color-status-success": "22 148 99",
      "--wb-color-status-warning": "201 120 8",
      "--wb-color-status-error": "205 43 49",
      "--wb-color-status-info": "2 132 199",
      "--wb-color-grid-major": "176 176 184",
      "--wb-color-grid-minor": "220 220 226",
    },
  },
};

const PlatformThemeContext = createContext<PlatformThemeContextValue | null>(null);

function getInitialTheme(defaultTheme: PlatformTheme, storageKey: string): PlatformTheme {
  if (typeof window === "undefined") {
    return defaultTheme;
  }

  try {
    const storedTheme = window.localStorage.getItem(storageKey);
    if (storedTheme === "dark" || storedTheme === "light") {
      return storedTheme;
    }
  } catch {
    // Storage may be unavailable in an embedded or privacy-restricted browser.
  }

  return defaultTheme;
}

export function PlatformThemeProvider({
  children,
  defaultTheme = "light",
  storageKey = DEFAULT_STORAGE_KEY,
}: PlatformThemeProviderProps) {
  const [theme, setTheme] = useState<PlatformTheme>(() =>
    getInitialTheme(defaultTheme, storageKey),
  );
  const themeConfig = platformThemeConfig[theme];

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(storageKey, theme);
    } catch {
      // Theme switching remains available even when the preference cannot persist.
    }
  }, [storageKey, theme]);

  const value = useMemo<PlatformThemeContextValue>(
    () => ({
      theme,
      setTheme,
      toggleTheme: () => {
        setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
      },
    }),
    [theme],
  );

  return (
    <PlatformThemeContext.Provider value={value}>
      <div
        data-testid="platform-theme-provider"
        data-wb-theme={theme}
        className="wb-platform-surface wb-theme-transition flex h-full min-h-full w-full min-w-0 flex-col overflow-hidden text-[rgb(var(--wb-color-text-primary))]"
        style={{
          ...(themeConfig.cssVars as CSSProperties),
          colorScheme: theme,
          backgroundColor: `rgb(var(--wb-color-bg-base))`,
          backgroundImage: themeConfig.backgroundGradient,
        }}
      >
        {children}
      </div>
    </PlatformThemeContext.Provider>
  );
}

export function usePlatformTheme() {
  const context = useContext(PlatformThemeContext);

  if (!context) {
    throw new Error("usePlatformTheme must be used within PlatformThemeProvider.");
  }

  return context;
}

export function PlatformThemeToggle(props: {
  compact?: boolean;
  className?: string;
}) {
  const { theme, toggleTheme } = usePlatformTheme();
  const nextTheme = theme === "dark" ? "light" : "dark";
  const nextThemeLabel = nextTheme === "dark" ? "Dark mode" : "Light mode";
  const icon = nextTheme === "dark" ? <MoonStar size={16} /> : <SunMedium size={16} />;

  if (props.compact) {
    return (
      <Tooltip label={`Switch to ${nextTheme} theme`}>
        <Button
          data-testid="platform-theme-toggle"
          onClick={toggleTheme}
          aria-pressed={theme === "dark"}
          aria-label={`Activate ${nextTheme} theme`}
          className={props.className}
          variant="outline"
          size="icon-sm"
        >
          {icon}
        </Button>
      </Tooltip>
    );
  }

  return (
    <Button
      type="button"
      data-testid="platform-theme-toggle"
      onClick={toggleTheme}
      aria-pressed={theme === "dark"}
      aria-label={`Activate ${nextTheme} theme`}
      title={`Switch to ${nextTheme} theme`}
      variant="outline"
      className={props.className}
    >
      {icon}
      {nextThemeLabel}
    </Button>
  );
}

export function SectionNotice(props: {
  title: string;
  body: string;
  tone?: "info" | "warning";
}) {
  const warning = props.tone === "warning";

  return (
    <div
      role="status"
      className={cn(
        "rounded-[10px] border px-3 py-2.5 text-sm",
        warning
          ? "border-[rgb(var(--wb-color-status-warning)/0.26)] bg-[rgb(var(--wb-color-status-warning)/0.1)] text-[rgb(var(--wb-color-status-warning))]"
          : "border-[rgb(var(--wb-color-status-info)/0.22)] bg-[rgb(var(--wb-color-status-info)/0.08)] text-[rgb(var(--wb-color-status-info))]",
      )}
    >
      <div className="mb-1 font-bold text-[rgb(var(--wb-color-text-primary))]">{props.title}</div>
      <div className="leading-relaxed text-[rgb(var(--wb-color-text-secondary))]">{props.body}</div>
    </div>
  );
}
