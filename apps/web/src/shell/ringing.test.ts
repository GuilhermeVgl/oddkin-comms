import type { CallInvitation } from "@crewstead/api-client";
import { describe, expect, it } from "vitest";
import { RING_MS, isRinging } from "./ringing";

const invitation: CallInvitation = {
  callId: "c1",
  conversationId: "k1",
  startedBy: "ana@crewstead.test",
  createdAt: "2026-10-26T10:00:00Z",
};

describe("incoming call ringing", () => {
  const start = new Date(invitation.createdAt).getTime();

  it("rings for a fresh call", () => {
    expect(isRinging(invitation, start + 1000)).toBe(true);
  });

  it("stops ringing after the ring window, even if the call goes on", () => {
    expect(isRinging(invitation, start + RING_MS - 1)).toBe(true);
    expect(isRinging(invitation, start + RING_MS)).toBe(false);
  });
});
