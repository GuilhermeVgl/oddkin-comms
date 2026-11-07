import type { DirectConversation } from "@crewstead/api-client";
import { displayNameOf } from "../../design/people";
import type { Channel } from "../../inbox";
import type { ProjectState } from "../../workspace";
import type { ThreadTarget } from "./types";

function can(state: ProjectState, permission: string): boolean {
  const granted = state.project.permissions as string[] | undefined;
  return granted === undefined || granted.includes(permission);
}

/** Resolves a conversation id to the same thread model used by Messages. */
export function threadTargetFor(
  conversationId: string,
  input: {
    channels: readonly Channel[];
    dms: readonly DirectConversation[];
    projects: readonly ProjectState[] | null;
  },
): ThreadTarget | null {
  const channel = input.channels.find((entry) => entry.id === conversationId);
  if (channel !== undefined) {
    const state = input.projects?.find(
      (entry) => entry.project.id === channel.projectId,
    );
    if (state === undefined) return null;
    return {
      kind: "chat",
      id: channel.id,
      projectId: channel.projectId,
      title: `#${channel.name}`,
      subtitle: `${state.project.name} · ${state.members.length} pessoas`,
      members: state.members,
      crypto: state.crypto,
      moderator: state.project.isManager,
      canSend: can(state, "chat.send") && !channel.archived,
      canCall: can(state, "calls.start"),
      canReact: can(state, "chat.send"),
      canUpload: can(state, "files.upload"),
    };
  }
  const dm = input.dms.find((entry) => entry.id === conversationId);
  if (dm === undefined) return null;
  return {
    kind: "dm",
    id: dm.id,
    title: displayNameOf(dm.peerEmail, dm.peerDisplayName),
    subtitle: "Conversa direta",
    peerEmail: dm.peerEmail,
    peerId: dm.peerId,
  };
}
