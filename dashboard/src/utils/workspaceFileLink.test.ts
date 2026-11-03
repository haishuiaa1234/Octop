import { describe, expect, it } from "vitest";
import { sandboxWorkspacePath } from "./workspaceFileLink";

describe("sandboxWorkspacePath", () => {
  it("maps the reported diagram URL to a workspace-relative path", () => {
    expect(
      sandboxWorkspacePath(
        "sandbox:/generated/dna_species_report_flow.excalidraw",
      ),
    ).toBe("generated/dna_species_report_flow.excalidraw");
  });

  it("decodes Unicode and spaces exactly once", () => {
    expect(
      sandboxWorkspacePath(
        "sandbox:/generated/%E6%B5%81%E7%A8%8B%20%E5%9B%BE.excalidraw",
      ),
    ).toBe("generated/流程 图.excalidraw");
  });

  it.each([
    "https://example.com/file.pdf",
    "javascript:alert(1)",
    "sandbox://example.com/file.pdf",
    "sandbox:/../secret",
    "sandbox:/generated/../../secret",
    "sandbox:/generated/%2e%2e/secret",
    "sandbox:/generated/%2Fetc/passwd",
    "sandbox:/C:/secret",
    "sandbox:/generated/..\\secret",
    "sandbox:/generated/%00file",
    "sandbox:/generated/file?path=secret",
    "sandbox:/generated/file#secret",
    "sandbox:/generated/%invalid",
    "sandbox:/",
  ])("rejects unsafe or non-sandbox URL %s", (href) => {
    expect(sandboxWorkspacePath(href)).toBeNull();
  });
});
