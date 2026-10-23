import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Dialog } from "./dialog";

describe("Dialog accessibility", () => {
  const showModalDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
  beforeEach(() => {
    // jsdom does not implement modal opening; the browser suite covers it.
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value(this: HTMLDialogElement) { this.open = true; },
    });
  });
  afterEach(() => {
    if (showModalDescriptor) Object.defineProperty(HTMLDialogElement.prototype, "showModal", showModalDescriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  });

  it("associates each dialog with its own title and description", () => {
    render(<>
      <Dialog open onClose={() => {}} title={<span>Import Workflow</span>} description="Choose where to import the workflow.">
        Import options
      </Dialog>
      <Dialog open={false} onClose={() => {}} title="Delete workflow?" description="This cannot be undone.">
        Delete options
      </Dialog>
    </>);

    const dialog = screen.getByRole("dialog", { name: "Import Workflow" });
    expect(dialog).toHaveAccessibleDescription("Choose where to import the workflow.");
    const titles = Array.from(document.querySelectorAll("dialog")).map(element => element.getAttribute("aria-labelledby"));
    expect(new Set(titles).size).toBe(2);
  });
});
