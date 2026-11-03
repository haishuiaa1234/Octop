import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Markdown from "./index";

const { requestBlob, saveBlobAsFile, showError } = vi.hoisted(() => ({
  requestBlob: vi.fn(),
  saveBlobAsFile: vi.fn(),
  showError: vi.fn(),
}));
vi.mock("@/utils/antdMessage", () => ({ message: { error: showError } }));

vi.mock("../../api/request", () => ({ requestBlob }));
vi.mock("../../utils/saveBlobAsFile", () => ({ saveBlobAsFile }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const path = "generated/dna_species_report_flow.excalidraw";
const content = `[Download diagram](sandbox:/${path})`;

beforeEach(() => {
  vi.clearAllMocks();
  requestBlob.mockResolvedValue(new Blob(["diagram"]));
  saveBlobAsFile.mockResolvedValue(undefined);
});

describe("Markdown workspace files", () => {
  it("preserves nested sandbox directories for both download and preview", async () => {
    const nested = "generated/inbound/workspace/flow.excalidraw";
    const open = vi.fn();
    render(
      <Markdown
        content={`[Diagram](sandbox:/${nested})`}
        workspaceAgentId="member"
        onOpenWorkspaceFile={open}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "common.preview" }));
    expect(open).toHaveBeenCalledWith(nested, "member");
    fireEvent.click(screen.getByRole("button", { name: "Diagram" }));
    await waitFor(() =>
      expect(requestBlob).toHaveBeenCalledWith(
        `/agents/member/workspace/download?path=${encodeURIComponent(nested)}`,
      ),
    );
  });

  it("explains when the linked file does not exist", async () => {
    requestBlob.mockRejectedValue(new Error("404 Not Found"));
    render(<Markdown content={content} workspaceAgentId="member" />);
    fireEvent.click(screen.getByRole("button", { name: "Download diagram" }));
    await waitFor(() =>
      expect(showError).toHaveBeenCalledWith("workspace.fileUnavailable"),
    );
    expect(saveBlobAsFile).not.toHaveBeenCalled();
  });

  it("preserves the server's permission error", async () => {
    requestBlob.mockRejectedValue(
      new Error(
        '403 - {"error":{"code":"FORBIDDEN","message":"Access denied"}}',
      ),
    );
    render(<Markdown content={content} workspaceAgentId="member" />);
    fireEvent.click(screen.getByRole("button", { name: "Download diagram" }));
    await waitFor(() =>
      expect(showError).toHaveBeenCalledWith("Access denied"),
    );
  });

  it("downloads sandbox links through the producer's authenticated API", async () => {
    render(<Markdown content={content} workspaceAgentId="member:one" />);
    fireEvent.click(screen.getByRole("button", { name: "Download diagram" }));
    await waitFor(() =>
      expect(requestBlob).toHaveBeenCalledWith(
        `/agents/member%3Aone/workspace/download?path=${encodeURIComponent(
          path,
        )}`,
      ),
    );
    expect(saveBlobAsFile).toHaveBeenCalledWith(
      expect.any(Blob),
      "dna_species_report_flow.excalidraw",
    );
  });

  it("opens the existing dock for preview without downloading first", () => {
    const open = vi.fn();
    render(
      <Markdown
        content={content}
        workspaceAgentId="member"
        onOpenWorkspaceFile={open}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "common.preview" }));
    expect(open).toHaveBeenCalledWith(path, "member");
    expect(requestBlob).not.toHaveBeenCalled();
  });

  it("does not make sandbox URLs actionable without an agent", () => {
    render(<Markdown content={content} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Download diagram")).not.toHaveAttribute(
      "href",
      expect.stringContaining("sandbox:"),
    );
  });

  it("keeps normal links and default dangerous-protocol filtering", () => {
    render(
      <Markdown
        content="[Web](https://example.com) [Unsafe](javascript:alert)"
        workspaceAgentId="member"
      />,
    );
    expect(screen.getByText("Web")).toHaveAttribute(
      "href",
      "https://example.com",
    );
    expect(screen.getByText("Unsafe")).not.toHaveAttribute(
      "href",
      expect.stringContaining("javascript:"),
    );
  });
});
