import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OctopAgent } from "../../../context/AgentContext";
import { useSharedTeamMembers } from "./useSharedTeamMembers";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../../api/modules/teams", () => ({ teamsApi: { get } }));

const team = {
  agent_id: "crew",
  kind: "team",
  is_shared: true,
  is_owner: false,
} as OctopAgent;

const member = {
  agent_id: "private-member",
  name: "Private member",
  icon_url: "/member.png",
};

describe("useSharedTeamMembers", () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue({ members: [member] });
  });

  it("loads display summaries for a shared team viewer", async () => {
    const { result } = renderHook(() => useSharedTeamMembers(team));
    await waitFor(() => expect(result.current).toEqual([member]));
    expect(get).toHaveBeenCalledWith("crew");
  });

  it("does not fetch details for owned teams or solo experts", () => {
    const { result, rerender } = renderHook(
      ({ agent }) => useSharedTeamMembers(agent),
      { initialProps: { agent: { ...team, is_owner: true } } },
    );
    expect(result.current).toEqual([]);
    rerender({ agent: { ...team, kind: "expert", is_owner: false } });
    expect(result.current).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it("drops old summaries immediately when leaving the team", async () => {
    const { result, rerender } = renderHook(
      ({ agent }: { agent: OctopAgent | null }) => useSharedTeamMembers(agent),
      { initialProps: { agent: team } },
    );
    await waitFor(() => expect(result.current).toEqual([member]));
    rerender({ agent: null });
    expect(result.current).toEqual([]);
  });

  it("refreshes a changed roster without showing the previous summaries", async () => {
    const changedMember = {
      ...member,
      agent_id: "new-member",
      name: "New member",
    };
    let resolveCurrent!: (value: { members: (typeof member)[] }) => void;
    const { result, rerender } = renderHook(
      ({ agent }) => useSharedTeamMembers(agent),
      { initialProps: { agent: { ...team, member_ids: [member.agent_id] } } },
    );
    await waitFor(() => expect(result.current).toEqual([member]));
    get.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCurrent = resolve;
      }),
    );
    rerender({ agent: { ...team, member_ids: [changedMember.agent_id] } });
    expect(result.current).toEqual([]);
    expect(get).toHaveBeenCalledTimes(2);
    await act(async () => resolveCurrent({ members: [changedMember] }));
    expect(result.current).toEqual([changedMember]);
  });

  it("does not reuse old names while re-entering the same team", async () => {
    let resolveCurrent!: (value: { members: (typeof member)[] }) => void;
    const { result, rerender } = renderHook(
      ({ agent }: { agent: OctopAgent | null }) => useSharedTeamMembers(agent),
      { initialProps: { agent: team } },
    );
    await waitFor(() => expect(result.current).toEqual([member]));
    rerender({ agent: null });
    get.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCurrent = resolve;
      }),
    );
    rerender({ agent: team });
    expect(result.current).toEqual([]);
    expect(get).toHaveBeenCalledTimes(2);
    const renamed = { ...member, name: "Renamed member" };
    await act(async () => resolveCurrent({ members: [renamed] }));
    expect(result.current).toEqual([renamed]);
  });

  it("ignores an old roster response for the same team", async () => {
    let resolveOld!: (value: { members: (typeof member)[] }) => void;
    let resolveCurrent!: (value: { members: (typeof member)[] }) => void;
    get.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    get.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCurrent = resolve;
      }),
    );
    const { result, rerender } = renderHook(
      ({ agent }) => useSharedTeamMembers(agent),
      { initialProps: { agent: { ...team, member_ids: [member.agent_id] } } },
    );
    const changedMember = {
      ...member,
      agent_id: "new-member",
      name: "New member",
    };
    rerender({ agent: { ...team, member_ids: [changedMember.agent_id] } });
    expect(get).toHaveBeenCalledTimes(2);
    await act(async () => resolveCurrent({ members: [changedMember] }));
    await act(async () => resolveOld({ members: [member] }));
    expect(result.current).toEqual([changedMember]);
  });

  it("ignores an old team response after navigation", async () => {
    let resolveOld!: (value: { members: (typeof member)[] }) => void;
    get.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    const { result, rerender } = renderHook(
      ({ agent }) => useSharedTeamMembers(agent),
      { initialProps: { agent: team } },
    );
    rerender({ agent: { ...team, agent_id: "other-crew" } });
    await waitFor(() => expect(result.current).toEqual([member]));
    await act(async () => resolveOld({ members: [] }));
    expect(result.current).toEqual([member]);
  });

  it("leaves summaries empty when sharing access is unavailable", async () => {
    get.mockRejectedValue(new Error("forbidden"));
    const { result } = renderHook(() => useSharedTeamMembers(team));
    await waitFor(() => expect(get).toHaveBeenCalledWith("crew"));
    expect(result.current).toEqual([]);
  });
});
