import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { externalApi } from "../../../api/modules/externalApi";
import { copyText } from "../../../utils/copyText";
import ExternalApiButton from "./ExternalApiButton";

const translate = vi.hoisted(() => (key: string) => key);
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}));
vi.mock("../../../api/modules/externalApi", () => ({
  externalApi: { getConfig: vi.fn(), configure: vi.fn() },
}));
vi.mock("../../../utils/copyText", () => ({ copyText: vi.fn() }));
vi.mock("../../../utils/antdMessage", () => ({
  message: { success: vi.fn(), error: vi.fn() },
}));

const expert = { agent_id: "expert-a", name: "Expert A", is_owner: true };
const disabled = { agent_id: "expert-a", enabled: false, key_prefix: null };
const enabled = {
  agent_id: "expert-a",
  enabled: true,
  key_prefix: "octop_prefix",
};

const getComputedStyle = window.getComputedStyle;
beforeAll(() => {
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
    getComputedStyle(element),
  );
});
afterAll(() => vi.restoreAllMocks());

async function openDrawer() {
  fireEvent.click(
    screen.getByRole("button", { name: "experts.externalApi.title" }),
  );
  await screen.findByRole("switch", { name: "experts.externalApi.enabled" });
}

describe("ExternalApiButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("BASE_URL", "");
    vi.mocked(externalApi.getConfig).mockResolvedValue(disabled);
    vi.mocked(copyText).mockResolvedValue(true);
  });

  it("does not fetch settings until the independent button is clicked", async () => {
    render(<ExternalApiButton agent={expert} />);
    expect(externalApi.getConfig).not.toHaveBeenCalled();
    await openDrawer();
    expect(externalApi.getConfig).toHaveBeenCalledWith("expert-a");
    expect(screen.getByText("Expert A")).toBeInTheDocument();
  });

  it("does not expose management controls to shared viewers", () => {
    render(<ExternalApiButton agent={{ ...expert, is_owner: false }} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(externalApi.getConfig).not.toHaveBeenCalled();
  });

  it("ignores a late settings response from a previously selected expert", async () => {
    let finishFirst!: (value: typeof enabled) => void;
    vi.mocked(externalApi.getConfig)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
      )
      .mockResolvedValueOnce({
        agent_id: "expert-b",
        enabled: false,
        key_prefix: "octop_expert-b",
      });
    const { rerender } = render(<ExternalApiButton agent={expert} />);
    fireEvent.click(
      screen.getByRole("button", { name: "experts.externalApi.title" }),
    );
    await waitFor(() =>
      expect(externalApi.getConfig).toHaveBeenCalledWith("expert-a"),
    );
    rerender(
      <ExternalApiButton
        agent={{ ...expert, agent_id: "expert-b", name: "Expert B" }}
      />,
    );
    await screen.findByDisplayValue("octop_expert-b...");
    finishFirst(enabled);
    await waitFor(() => expect(screen.getByRole("switch")).not.toBeChecked());
    expect(screen.getByText("Expert B")).toBeInTheDocument();
    expect(
      screen.queryByDisplayValue("octop_prefix..."),
    ).not.toBeInTheDocument();
  });

  it("enables access and displays the newly generated key for copying", async () => {
    vi.mocked(externalApi.configure).mockResolvedValue({
      ...enabled,
      api_key: "octop_new-secret",
    });
    render(<ExternalApiButton agent={expert} />);
    await openDrawer();
    fireEvent.click(screen.getByRole("switch"));
    expect(
      await screen.findByDisplayValue("octop_new-secret"),
    ).toBeInTheDocument();
    expect(externalApi.configure).toHaveBeenCalledWith("expert-a", {
      enabled: true,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "experts.externalApi.copyKey" }),
    );
    await waitFor(() =>
      expect(copyText).toHaveBeenCalledWith("octop_new-secret"),
    );
  });

  it("clears the plaintext key when the drawer is closed and reopened", async () => {
    vi.mocked(externalApi.configure).mockResolvedValue({
      ...enabled,
      api_key: "octop_one-time",
    });
    render(<ExternalApiButton agent={expert} />);
    await openDrawer();
    fireEvent.click(screen.getByRole("switch"));
    await screen.findByDisplayValue("octop_one-time");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    vi.mocked(externalApi.getConfig).mockResolvedValue(enabled);
    await openDrawer();
    expect(
      screen.queryByDisplayValue("octop_one-time"),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByDisplayValue("octop_prefix..."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "experts.externalApi.copyKey" }),
    ).not.toBeInTheDocument();
  });

  it("disables access without rotating the existing key", async () => {
    vi.mocked(externalApi.getConfig).mockResolvedValue(enabled);
    vi.mocked(externalApi.configure).mockResolvedValue({
      ...enabled,
      enabled: false,
    });
    render(<ExternalApiButton agent={expert} />);
    await openDrawer();
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(screen.getByRole("switch")).not.toBeChecked());
    expect(externalApi.configure).toHaveBeenCalledWith("expert-a", {
      enabled: false,
    });
  });

  it("reenables the existing key without requesting a rotation", async () => {
    vi.mocked(externalApi.getConfig).mockResolvedValue({
      ...enabled,
      enabled: false,
    });
    vi.mocked(externalApi.configure).mockResolvedValue(enabled);
    render(<ExternalApiButton agent={expert} />);
    await openDrawer();
    expect(
      screen.getByRole("button", { name: "experts.externalApi.rotate" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(screen.getByRole("switch")).toBeChecked());
    expect(externalApi.configure).toHaveBeenCalledWith("expert-a", {
      enabled: true,
    });
    expect(
      screen.queryByRole("button", { name: "experts.externalApi.copyKey" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the drawer open while key generation is in flight", async () => {
    let complete!: (value: typeof enabled & { api_key: string }) => void;
    vi.mocked(externalApi.configure).mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    render(<ExternalApiButton agent={expert} />);
    await openDrawer();
    fireEvent.click(screen.getByRole("switch"));
    expect(
      screen.queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("switch")).toBeDisabled();
    complete({ ...enabled, api_key: "octop_pending" });
    await screen.findByDisplayValue("octop_pending");
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("uses the configured backend origin for the public API address", async () => {
    vi.stubGlobal("BASE_URL", "https://octop.example.test");
    render(<ExternalApiButton agent={expert} />);
    await openDrawer();
    expect(
      screen.getByDisplayValue("https://octop.example.test/api/v1/expert-api"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("/sessions/{session_id}/messages"),
    ).toBeInTheDocument();
    expect(screen.getByText("/tasks/{task_id}")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("requires confirmation before rotating the enabled expert key", async () => {
    vi.mocked(externalApi.getConfig).mockResolvedValue(enabled);
    vi.mocked(externalApi.configure).mockResolvedValue({
      ...enabled,
      api_key: "octop_rotated",
    });
    render(<ExternalApiButton agent={expert} />);
    await openDrawer();
    fireEvent.click(
      screen.getByRole("button", { name: "experts.externalApi.rotate" }),
    );
    expect(externalApi.configure).not.toHaveBeenCalled();
    fireEvent.click(
      await screen.findByRole("button", { name: "common.confirm" }),
    );
    await screen.findByDisplayValue("octop_rotated");
    expect(externalApi.configure).toHaveBeenCalledWith("expert-a", {
      enabled: true,
      rotate: true,
    });
  });

  it("retains the enabled state and reports a failed disable", async () => {
    vi.mocked(externalApi.getConfig).mockResolvedValue(enabled);
    vi.mocked(externalApi.configure).mockRejectedValue(new Error("denied"));
    render(<ExternalApiButton agent={expert} />);
    await openDrawer();
    fireEvent.click(screen.getByRole("switch"));
    expect(await screen.findByText("denied")).toBeInTheDocument();
    expect(screen.getByRole("switch")).toBeChecked();
  });

  it("shows a retry control after loading fails instead of allowing changes", async () => {
    vi.mocked(externalApi.getConfig).mockRejectedValueOnce(
      new Error("offline"),
    );
    render(<ExternalApiButton agent={expert} />);
    fireEvent.click(
      screen.getByRole("button", { name: "experts.externalApi.title" }),
    );
    expect(await screen.findByText("offline")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
    await screen.findByRole("switch");
    expect(externalApi.getConfig).toHaveBeenCalledTimes(2);
  });
});
