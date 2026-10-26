import type { CallInvitation } from "@crewstead/api-client";

/** How long a call keeps ringing; after that the thread still offers "Entrar". */
export const RING_MS = 45_000;

/** Whether an invitation is still worth ringing for, given the current time. */
export function isRinging(invitation: CallInvitation, now: number): boolean {
  const age = now - new Date(invitation.createdAt).getTime();
  return age < RING_MS;
}
