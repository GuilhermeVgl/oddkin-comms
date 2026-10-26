import type { CurrentAccount, Device } from "@crewstead/api-client";
import type { Scope } from "./projectCrypto";
import type { Phase } from "./types";

/** The step for a browser that has no device record yet. */
export function phaseWithoutDevice(
  historyMode: CurrentAccount["historyMode"],
  organizationHasRoot: boolean,
): Extract<Phase, "not_enabled" | "not_configured" | "needs_device"> {
  if (historyMode === "none") return "not_enabled";
  return organizationHasRoot ? "needs_device" : "not_configured";
}

/** The step for a browser whose device the server knows (or no longer knows). */
export function phaseForDevice(
  state: Device["state"] | undefined,
  unlocked: boolean,
): Extract<Phase, "revoked" | "pending_approval" | "unlocked" | "locked"> {
  if (state === undefined || state === "revoked") return "revoked";
  if (state === "pending") return "pending_approval";
  return unlocked ? "unlocked" : "locked";
}

/** One cache slot per scope of content the browser has opened. */
export function scopeCacheKey(scope: Scope): string {
  if (scope.type === "project") return `p:${scope.projectId}`;
  if (scope.type === "conversation") return `c:${scope.conversationId}`;
  return "org";
}

/** The part of an invitation link that carries the history secret. */
export function historyInviteLink(
  secret: string,
  rootFingerprint: string,
): string {
  return `k=${secret}&rf=${rootFingerprint.replace(/\s/g, "")}`;
}
