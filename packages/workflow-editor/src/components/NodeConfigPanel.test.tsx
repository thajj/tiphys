import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlatformThemeProvider } from "@argocanvas/ui-platform";
import type { FlowNodeData } from "@argocanvas/workflow-domain";
import { sampleNodes } from "../testing/fixtures";
import { geminiService } from "../services/geminiService";
import NodeConfigPanel from "./NodeConfigPanel";

afterEach(() => vi.restoreAllMocks());

function requestAiEdit() {
  fireEvent.click(screen.getByRole("button", { name: "Edit with AI" }));
  fireEvent.change(screen.getByPlaceholderText(/^e.g. Change image/), { target: { value: "Upgrade the image" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply AI instruction" }));
}

function pendingAiEdit() {
  let resolve!: (data: FlowNodeData) => void;
  vi.spyOn(geminiService, "editNode").mockImplementation(() => new Promise<FlowNodeData>(complete => { resolve = complete; }));
  return (data: FlowNodeData) => act(async () => resolve(data));
}

describe("node form synchronization", () => {
  it("keeps a local edit across unchanged parent data, then accepts a real external update with the same ID", () => {
    const node = structuredClone(sampleNodes[0]);
    const onChange = vi.fn();
    const panel = (selectedNode: typeof node) => <PlatformThemeProvider><NodeConfigPanel selectedNode={selectedNode} onChange={onChange} onDelete={() => {}} /></PlatformThemeProvider>;
    const { rerender } = render(panel(node));
    fireEvent.change(screen.getByDisplayValue("Extract Data"), { target: { value: "Pending local edit" } });

    // Selection/position updates may supply a fresh object before a local edit
    // is echoed. The unchanged source data must not reset the text being typed.
    rerender(panel({ ...structuredClone(node), position: { x: 300, y: 200 } }));
    expect(screen.getByDisplayValue("Pending local edit")).toBeTruthy();

    rerender(panel({ ...node, data: { ...node.data, label: "Restored by undo", container: { ...node.data.container!, image: "python:3.14" } } }));
    expect(screen.getByDisplayValue("Restored by undo")).toBeTruthy();
    expect(screen.getByDisplayValue("python:3.14")).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue("Restored by undo"), { target: { value: "Next edit" } });
    expect(onChange).toHaveBeenLastCalledWith(node.id, expect.objectContaining({ label: "Next edit", container: expect.objectContaining({ image: "python:3.14" }) }));
  });

  it("ignores an AI response after another node is selected", async () => {
    const complete = pendingAiEdit();
    const onChange = vi.fn();
    const panel = (selectedNode: typeof sampleNodes[number]) => <PlatformThemeProvider><NodeConfigPanel selectedNode={selectedNode} onChange={onChange} onDelete={() => {}} /></PlatformThemeProvider>;
    const { rerender } = render(panel(sampleNodes[0]));
    requestAiEdit();
    rerender(panel(sampleNodes[1]));
    await complete({ ...sampleNodes[0].data, label: "Stale AI response" });
    expect(screen.getByDisplayValue("Train Model")).toBeTruthy();
    expect(screen.queryByDisplayValue("Stale AI response")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not let an AI response overwrite newer manual edits", async () => {
    const complete = pendingAiEdit();
    const onChange = vi.fn();
    render(<PlatformThemeProvider><NodeConfigPanel selectedNode={sampleNodes[0]} onChange={onChange} onDelete={() => {}} /></PlatformThemeProvider>);
    requestAiEdit();
    fireEvent.change(screen.getByDisplayValue("Extract Data"), { target: { value: "New manual name" } });
    await complete({ ...sampleNodes[0].data, label: "Stale AI response" });
    expect(screen.getByDisplayValue("New manual name")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("node changed");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(sampleNodes[0].id, expect.objectContaining({ label: "New manual name" }));
  });

  it("shows the actual AI failure and allows retry", async () => {
    const editNode = vi.spyOn(geminiService, "editNode").mockRejectedValue(new Error("AI gateway timed out"));
    const onChange = vi.fn();
    render(<PlatformThemeProvider><NodeConfigPanel selectedNode={sampleNodes[0]} onChange={onChange} onDelete={() => {}} /></PlatformThemeProvider>);
    requestAiEdit();
    expect((await screen.findByRole("alert")).textContent).toBe("AI gateway timed out");
    expect((screen.getByRole("button", { name: "Apply AI instruction" }) as HTMLButtonElement).disabled).toBe(false);
    expect(onChange).not.toHaveBeenCalled();

    editNode.mockResolvedValue({ ...sampleNodes[0].data, label: "AI updated name" });
    fireEvent.click(screen.getByRole("button", { name: "Apply AI instruction" }));
    expect(await screen.findByDisplayValue("AI updated name")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(sampleNodes[0].id, expect.objectContaining({ label: "AI updated name" }));
  });
});
