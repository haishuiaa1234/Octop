import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ExpertDeveloperResources from "./ExpertDeveloperResources";

const clipboard = vi.hoisted(() => ({
  copy: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("../../../utils/copyText", () => ({ copyText: clipboard.copy }));
vi.mock("../../../utils/antdMessage", () => ({
  message: { success: clipboard.success, error: clipboard.error },
}));

describe("Expert development resources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clipboard.copy.mockResolvedValue(true);
  });

  it("links to the private repository archive without embedding credentials", () => {
    render(<ExpertDeveloperResources />);
    const download = screen.getByRole("link", {
      name: "experts.development.download",
    });
    expect(download).toHaveAttribute(
      "href",
      "http://10.1.3.254/report-group/expert-archives/-/archive/master/expert-archives-master.zip",
    );
    expect(download).toHaveAttribute("target", "_blank");
    expect(download).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("opens the guide with repository, setup, development, publish and update instructions", async () => {
    render(<ExpertDeveloperResources />);
    fireEvent.click(
      screen.getByRole("button", { name: "experts.development.guide" }),
    );
    const guide = within(await screen.findByRole("dialog"));
    expect(
      guide.getByRole("link", { name: "experts.development.repository" }),
    ).toHaveAttribute("href", "http://10.1.3.254/report-group/expert-archives");
    expect(
      guide.getByText(/python -m pip install -r requirements.txt/),
    ).toBeInTheDocument();
    expect(
      guide.getByText(/python manage.py init my-expert/),
    ).toBeInTheDocument();
    expect(
      guide.getByText(/python manage.py validate my-expert/),
    ).toBeInTheDocument();
    expect(guide.getByText(".\\publish.cmd")).toBeInTheDocument();
    expect(
      guide.getByText("experts.development.updateDetail"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("copies the exact launch command and reports clipboard errors", async () => {
    render(<ExpertDeveloperResources />);
    fireEvent.click(
      screen.getByRole("button", { name: "experts.development.guide" }),
    );
    const button = await screen.findByRole("button", {
      name: "common.copy experts.development.publish",
    });
    fireEvent.click(button);
    await waitFor(() =>
      expect(clipboard.copy).toHaveBeenCalledWith(".\\publish.cmd"),
    );
    expect(clipboard.success).toHaveBeenCalledWith("common.copied");
    clipboard.copy.mockResolvedValue(false);
    fireEvent.click(button);
    await waitFor(() =>
      expect(clipboard.error).toHaveBeenCalledWith("common.copyFailed"),
    );
  });
});
