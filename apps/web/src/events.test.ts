import { describe, expect, it } from "vitest";
import { wantsReload, type DomainEvent } from "./events";

const event = (eventType: string): DomainEvent => ({
  eventId: "e1",
  eventType,
  resourceId: "r1",
  cursor: "1",
});

describe("which events reload a screen", () => {
  it("reloads on a resync whatever it listens to", () => {
    expect(wantsReload("resync", [])).toBe(true);
  });

  it("reloads only for the event types it listens to", () => {
    expect(
      wantsReload(event("call.changed"), ["call.changed", "call.invited"]),
    ).toBe(true);
    expect(wantsReload(event("message.created"), ["call.changed"])).toBe(false);
  });
});
