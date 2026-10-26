import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlatformThemeProvider } from "@tiphys/ui-platform";
import { YamlDocumentEditor } from "./YamlDocumentEditor";

// Exercise the document/draft lifecycle; real Monaco is covered in Chromium.
vi.mock("@monaco-editor/react", () => ({
  useMonaco: () => null,
  default: ({ value, onChange, options }: any) => <textarea aria-label="YAML source" value={value} onChange={event => onChange(event.target.value)} readOnly={options.readOnly} />,
}));

describe("YAML document drafts", () => {
  it("never applies one document's pending draft to another document", async () => {
    const firstApply = vi.fn();
    const secondApply = vi.fn();
    const editor = (documentId: string, value: string, onApply: (value: string) => void) => (
      <PlatformThemeProvider><YamlDocumentEditor title="Manifest" path="file:///workflow.yaml" documentId={documentId} value={value} onApply={onApply} /></PlatformThemeProvider>
    );
    const { rerender } = render(editor("session-a", "name: first", firstApply));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "YAML source" }), { target: { value: "name: pending-first" } });

    rerender(editor("session-b", "name: second", secondApply));
    expect((screen.getByRole("textbox", { name: "YAML source" }) as HTMLTextAreaElement).value).toBe("name: second");
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "YAML source" }), { target: { value: "name: updated-second" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await screen.findByText("YAML changes applied successfully.");
    expect(firstApply).not.toHaveBeenCalled();
    expect(secondApply).toHaveBeenCalledExactlyOnceWith("name: updated-second");
  });

  it("keeps a valid pending edit during updates to the same document", () => {
    const props = { title: "Manifest", path: "file:///workflow.yaml", documentId: "session-a", onApply: vi.fn() };
    const { rerender } = render(<PlatformThemeProvider><YamlDocumentEditor {...props} value="name: first" /></PlatformThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "YAML source" }), { target: { value: "name: pending" } });
    rerender(<PlatformThemeProvider><YamlDocumentEditor {...props} value="name: external-update" /></PlatformThemeProvider>);
    expect((screen.getByRole("textbox", { name: "YAML source" }) as HTMLTextAreaElement).value).toBe("name: pending");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect((screen.getByRole("textbox", { name: "YAML source" }) as HTMLTextAreaElement).value).toBe("name: external-update");
  });
});
