import { useEffect, useMemo, useState } from "react";
import { teamsApi, type TeamMemberSummary } from "../../../api/modules/teams";
import type { OctopAgent } from "../../../context/AgentContext";
import { isSharedExpertViewer } from "../../../utils/sharedExpert";
import { isTeamAgent } from "../../../utils/teamAgent";

const EMPTY_MEMBERS: TeamMemberSummary[] = [];

/** Room-local identities only; private members must not enter the agent picker. */
export function useSharedTeamMembers(agent: OctopAgent | null) {
  const teamId =
    agent && isTeamAgent(agent) && isSharedExpertViewer(agent)
      ? agent.agent_id
      : null;
  const rosterKey = JSON.stringify(agent?.member_ids ?? []);
  // Reference identity also separates return visits with the same roster.
  const requestScope = useMemo(
    () => ({ teamId, rosterKey }),
    [teamId, rosterKey],
  );
  const [roster, setRoster] = useState<{
    scope: typeof requestScope;
    members: TeamMemberSummary[];
  } | null>(null);

  useEffect(() => {
    setRoster(null);
    const { teamId } = requestScope;
    if (!teamId) return;
    let cancelled = false;
    void teamsApi
      .get(teamId)
      .then((team) => {
        if (!cancelled)
          setRoster({ scope: requestScope, members: team.members });
      })
      .catch(() => {
        if (!cancelled)
          setRoster({ scope: requestScope, members: EMPTY_MEMBERS });
      });
    return () => {
      cancelled = true;
    };
  }, [requestScope]);

  return roster?.scope === requestScope ? roster.members : EMPTY_MEMBERS;
}
