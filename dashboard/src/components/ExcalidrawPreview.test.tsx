import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExcalidrawPreview from "./ExcalidrawPreview";
import { getDocKind } from "../utils/docKind";

const { viewer, restore, translate } = vi.hoisted(() => ({
  viewer: vi.fn(),
  restore: vi.fn(),
  translate: (key: string) => key,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate, i18n: { language: "zh" } }),
}));
vi.mock("@excalidraw/excalidraw", () => ({
  Excalidraw: (props: Record<string, unknown>) => {
    viewer(props);
    return <div data-testid="diagram" />;
  },
  MainMenu: () => null,
  restore,
}));

const scene = {
  type: "excalidraw",
  elements: [{ id: "a", type: "rectangle" }],
};
const blob = (text: string) => ({ text: async () => text }) as Blob;

beforeEach(() => {
  vi.clearAllMocks();
  restore.mockImplementation((data) => ({
    elements: data.elements,
    files: data.files ?? {},
    appState: { viewBackgroundColor: "#ffffff" },
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("ExcalidrawPreview", () => {
  it("fits the scene again when the preview panel is resized", async () => {
    let resized!: ResizeObserverCallback;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resized = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const scrollToContent = vi.fn();
    render(
      <ExcalidrawPreview
        filename="flow.excalidraw"
        fetchBlob={async () => blob(JSON.stringify(scene))}
      />,
    );
    await screen.findByTestId("diagram");
    await waitFor(() => expect(resized).toBeTypeOf("function"));
    act(() => viewer.mock.lastCall![0].excalidrawAPI({ scrollToContent }));
    act(() => resized([], {} as ResizeObserver));
    await waitFor(() =>
      expect(scrollToContent).toHaveBeenCalledWith(undefined, {
        fitToContent: true,
        animate: false,
      }),
    );
  });

  it("classifies diagrams as rich documents, not editable text", () => {
    expect(getDocKind("generated/FLOW.EXCALIDRAW")).toBe("excalidraw");
    expect(getDocKind("legacy.DOC")).toBe("doc");
    expect(getDocKind("report.docx")).toBe("word");
  });

  it("loads a diagram in view-only mode with embedded assets only", async () => {
    const fetchBlob = vi.fn().mockResolvedValue(
      blob(
        JSON.stringify({
          ...scene,
          files: {
            local: { dataURL: "data:image/png;base64,AA==" },
            remote: { dataURL: "https://example.com/private.png" },
          },
        }),
      ),
    );
    render(
      <ExcalidrawPreview filename="flow.excalidraw" fetchBlob={fetchBlob} />,
    );
    await screen.findByTestId("diagram");
    const props = viewer.mock.lastCall![0];
    expect(props.viewModeEnabled).toBe(true);
    expect(props.validateEmbeddable).toBe(false);
    expect(props.handleKeyboardGlobally).toBe(false);
    expect(props.langCode).toBe("zh-CN");
    expect(props.initialData.scrollToContent).toBe(true);
    expect(Object.keys(props.initialData.files)).toEqual(["local"]);
    expect(fetchBlob.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
  });

  it.each([
    "broken JSON",
    '{"type":"other","elements":[]}',
    '{"type":"excalidraw","elements":null}',
  ])("shows an actionable invalid-file state for %s", async (content) => {
    render(
      <ExcalidrawPreview
        filename="flow.excalidraw"
        fetchBlob={async () => blob(content)}
        onDownload={vi.fn()}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "workspace.diagramInvalid",
    );
    expect(
      screen.getByRole("button", { name: "common.download" }),
    ).toBeInTheDocument();
    expect(viewer).not.toHaveBeenCalled();
  });

  it("reports a missing artifact instead of an empty canvas", async () => {
    render(
      <ExcalidrawPreview
        filename="flow.excalidraw"
        fetchBlob={async () => {
          throw new Error("404 Not Found");
        }}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "workspace.fileUnavailable",
    );
  });

  it("does not replace a newer file when an old fetch completes late", async () => {
    let complete!: (value: Blob) => void;
    const oldFetch = () =>
      new Promise<Blob>((resolve) => {
        complete = resolve;
      });
    const { rerender } = render(
      <ExcalidrawPreview filename="old.excalidraw" fetchBlob={oldFetch} />,
    );
    rerender(
      <ExcalidrawPreview
        filename="new.excalidraw"
        fetchBlob={async () => blob(JSON.stringify(scene))}
      />,
    );
    await screen.findByTestId("diagram");
    complete(blob("invalid old content"));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(viewer.mock.lastCall![0].name).toBe("new.excalidraw");
  });
});
