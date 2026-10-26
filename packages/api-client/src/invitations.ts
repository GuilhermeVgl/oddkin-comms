import type { components } from "./openapi.gen";
import type { createApiClient } from "./index";

export type Invitation = components["schemas"]["Invitation"];
export type InvitationStatus = components["schemas"]["InvitationStatus"];
export type HistoryMode = components["schemas"]["HistoryMode"];
export type MembershipKind =
  components["schemas"]["CreateInvitationRequest"]["membershipKind"];

export async function createInvitation(
  client: ReturnType<typeof createApiClient>,
  email: string,
  membershipKind: MembershipKind,
  csrfToken: string,
  history?: { historyMode: HistoryMode; linkExtra?: string },
  projectId?: string,
): Promise<Invitation> {
  const { data, response } = await client.POST("/api/v1/invitations", {
    body: {
      email,
      membershipKind,
      ...(history === undefined ? {} : { historyMode: history.historyMode }),
      ...(history?.linkExtra === undefined
        ? {}
        : { linkExtra: history.linkExtra }),
      ...(projectId === undefined ? {} : { projectId }),
    },
    headers: { "X-CSRF-Token": csrfToken },
  });
  if (response.status === 201 && data !== undefined) {
    return data;
  }
  throw new Error(`Unexpected invitation status: ${response.status}`);
}

export async function acceptInvitation(
  client: ReturnType<typeof createApiClient>,
  token: string,
  email: string,
  password?: string,
): Promise<"accepted" | "invalid" | "unavailable"> {
  const { response } = await client.POST("/api/v1/invitations/accept", {
    body: { token, email, ...(password === undefined ? {} : { password }) },
  });
  switch (response.status) {
    case 204:
      return "accepted";
    case 400:
      return "invalid";
    case 503:
      return "unavailable";
    default:
      throw new Error(
        `Unexpected invitation acceptance status: ${response.status}`,
      );
  }
}

export async function listInvitations(
  client: ReturnType<typeof createApiClient>,
  projectId?: string,
): Promise<InvitationStatus[]> {
  const { data, response } = await client.GET("/api/v1/invitations", {
    params: { query: projectId === undefined ? {} : { projectId } },
  });
  if (response.status === 200 && data !== undefined) return data;
  throw new Error(`Unexpected invitations status: ${response.status}`);
}
