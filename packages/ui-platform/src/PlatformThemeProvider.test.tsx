import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlatformThemeProvider, PlatformThemeToggle } from "./PlatformThemeProvider";

afterEach(() => vi.restoreAllMocks());

describe("theme storage fallback", () => {
  it.each(["unavailable", "full"] as const)("renders and switches themes when browser storage is %s", failure => {
    if (failure === "unavailable") {
      vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("Storage blocked", "SecurityError"); });
    } else {
      vi.spyOn(Storage.prototype, "getItem").mockReturnValue("dark");
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Storage full", "QuotaExceededError"); });
    }
    render(<PlatformThemeProvider defaultTheme="light"><PlatformThemeToggle /></PlatformThemeProvider>);
    const initialTheme = failure === "unavailable" ? "light" : "dark";
    const nextTheme = initialTheme === "light" ? "dark" : "light";
    expect(screen.getByTestId("platform-theme-provider").getAttribute("data-wb-theme")).toBe(initialTheme);
    fireEvent.click(screen.getByRole("button", { name: `Activate ${nextTheme} theme` }));
    expect(screen.getByTestId("platform-theme-provider").getAttribute("data-wb-theme")).toBe(nextTheme);
  });
});
