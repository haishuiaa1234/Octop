import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { TeamMemberSummary } from "../../api/modules/teams";

const EMPTY_TEAM_MEMBERS: TeamMemberSummary[] = [];

interface ChatAgentProfileContextValue {
  openAgentProfile: (agentId?: string) => void;
  canOpen: boolean;
  isTeam: boolean;
  teamMembers: TeamMemberSummary[];
}

const ChatAgentProfileContext =
  createContext<ChatAgentProfileContextValue | null>(null);

export function ChatAgentProfileProvider({
  canOpen,
  onOpen,
  isTeam = false,
  teamMembers = EMPTY_TEAM_MEMBERS,
  children,
}: {
  canOpen: boolean;
  onOpen: (agentId?: string) => void;
  isTeam?: boolean;
  teamMembers?: TeamMemberSummary[];
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({
      canOpen,
      isTeam,
      teamMembers,
      openAgentProfile: onOpen,
    }),
    [canOpen, isTeam, teamMembers, onOpen],
  );
  return (
    <ChatAgentProfileContext.Provider value={value}>
      {children}
    </ChatAgentProfileContext.Provider>
  );
}

export function useChatAgentProfile(): ChatAgentProfileContextValue | null {
  return useContext(ChatAgentProfileContext);
}
