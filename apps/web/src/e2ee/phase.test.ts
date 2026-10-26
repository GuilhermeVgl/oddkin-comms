import { describe, expect, it } from "vitest";
import {
  historyInviteLink,
  phaseForDevice,
  phaseWithoutDevice,
  scopeCacheKey,
} from "./phase";

describe("phaseWithoutDevice", () => {
  it("honours a person who chose no history, whatever the organization has", () => {
    expect(phaseWithoutDevice("none", true)).toBe("not_enabled");
    expect(phaseWithoutDevice("none", false)).toBe("not_enabled");
  });

  it("asks for a device when the organization already has a trust root", () => {
    expect(phaseWithoutDevice("ask", true)).toBe("needs_device");
    expect(phaseWithoutDevice("auto", true)).toBe("needs_device");
  });

  it("asks to set the organization up when there is no trust root yet", () => {
    expect(phaseWithoutDevice("ask", false)).toBe("not_configured");
    expect(phaseWithoutDevice("auto", false)).toBe("not_configured");
  });
});

describe("phaseForDevice", () => {
  it("treats a device the server does not list as revoked", () => {
    expect(phaseForDevice(undefined, true)).toBe("revoked");
    expect(phaseForDevice("revoked", true)).toBe("revoked");
  });

  it("waits for approval while the device is pending, even if unlocked", () => {
    expect(phaseForDevice("pending", true)).toBe("pending_approval");
    expect(phaseForDevice("pending", false)).toBe("pending_approval");
  });

  it("follows the vault for an active device", () => {
    expect(phaseForDevice("active", true)).toBe("unlocked");
    expect(phaseForDevice("active", false)).toBe("locked");
  });
});

describe("scopeCacheKey", () => {
  it("keeps a slot per project, conversation and the organization", () => {
    expect(scopeCacheKey({ type: "project", projectId: "a" })).toBe("p:a");
    expect(scopeCacheKey({ type: "conversation", conversationId: "a" })).toBe(
      "c:a",
    );
    expect(scopeCacheKey({ type: "organization" })).toBe("org");
  });
});

describe("historyInviteLink", () => {
  it("strips the grouping spaces of the fingerprint", () => {
    expect(historyInviteLink("sec", "AB CD\nEF 12")).toBe("k=sec&rf=ABCDEF12");
  });
});
