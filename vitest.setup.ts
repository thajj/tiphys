import "@testing-library/jest-dom";
import { vi } from "vitest";

// Monaco needs a real browser. Browser coverage exercises the locally bundled editor.
vi.mock("./packages/workflow-editor/src/yaml/monacoSetup", () => ({}));

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class DOMMatrixReadOnlyMock {
  m22 = 1;

  constructor(transform: string = "") {
    const match = transform.match(/matrix(3d)?\((.+)\)/);
    if (!match) {
      return;
    }

    const values = match[2]
      .split(",")
      .map((value) => Number.parseFloat(value.trim()))
      .filter((value) => Number.isFinite(value));

    if (match[1] === "3d" && values.length >= 6) {
      this.m22 = values[5];
      return;
    }

    if (!match[1] && values.length >= 4) {
      this.m22 = values[3];
    }
  }
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
}

if (!globalThis.DOMMatrixReadOnly) {
  globalThis.DOMMatrixReadOnly = DOMMatrixReadOnlyMock as typeof DOMMatrixReadOnly;
}
