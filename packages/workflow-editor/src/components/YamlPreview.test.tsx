import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlatformThemeProvider } from "@tiphys/ui-platform";
import { parseYamlToWorkflow } from "@tiphys/workflow-domain";
import YamlPreview from "./YamlPreview";

vi.mock("@monaco-editor/react", () => ({
  useMonaco: () => null,
  default: ({ value, onChange, options }: any) => <textarea aria-label="YAML source" value={value} onChange={event => onChange(event.target.value)} readOnly={options.readOnly} />,
}));

const IMPORTED = `# owned by the build team
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  name: imported
  namespace: workflows
spec:
  entrypoint: main
  templates:
    - name: main
      dag:
        tasks:
          - name: build
            template: build
    - name: build
      podSpecPatch: '{"terminationGracePeriodSeconds": 5}'
      container:
        image: example/build:1.0
`;

describe("YamlPreview for imported workflows", () => {
  const blocked = () => {
    const parsed = parseYamlToWorkflow(IMPORTED)!;
    parsed.nodes[0].data.label = "build-renamed";
    return parsed;
  };
  const renderPreview = (props: Partial<React.ComponentProps<typeof YamlPreview>> = {}) => {
    const parsed = blocked();
    return render(
      <PlatformThemeProvider>
        <YamlPreview nodes={parsed.nodes} edges={parsed.edges} metadata={parsed.metadata} spec={parsed.spec} onUpdate={vi.fn()} {...props} />
      </PlatformThemeProvider>,
    );
  };

  it("explains an edit that only YAML can express and offers no export of a stale manifest", () => {
    renderPreview();
    expect(screen.getByRole("alert").textContent).toMatch(/make this change in the yaml editor instead/i);
    expect(screen.queryByRole("textbox", { name: "YAML source" })).toBeNull();
    for (const action of ["Copy", "Download", "Edit"]) expect(screen.queryByRole("button", { name: action })).toBeNull();
  });

  it("opens the original imported YAML only on request, labelled as not including the visual edits", () => {
    renderPreview();
    fireEvent.click(screen.getByRole("button", { name: "Open imported YAML" }));
    expect((screen.getByRole("textbox", { name: "YAML source" }) as HTMLTextAreaElement).value).toBe(IMPORTED);
    expect(screen.getByText(/without your visual edits/i)).toBeTruthy();
  });

  it("offers Undo beside a blocked export when there is a change to undo", () => {
    const onUndo = vi.fn();
    const { unmount } = renderPreview({ onUndo, canUndo: true });
    fireEvent.click(screen.getByRole("button", { name: "Undo last change" }));
    expect(onUndo).toHaveBeenCalledOnce();
    unmount();
    renderPreview({ onUndo, canUndo: false });
    expect(screen.queryByRole("button", { name: "Undo last change" })).toBeNull();
  });
});
