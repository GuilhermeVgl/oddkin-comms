import { describe, expect, it } from "vitest";
import { setOutgoingState, type Outgoing } from "./outgoing";

const list: Outgoing[] = [
  { id: "a", body: "um", state: "pending" },
  { id: "b", body: "dois", state: "pending" },
];

describe("outgoing messages", () => {
  it("marks one message as failed and leaves the others alone", () => {
    expect(setOutgoingState(list, "b", "failed")).toEqual([
      { id: "a", body: "um", state: "pending" },
      { id: "b", body: "dois", state: "failed" },
    ]);
  });

  it("puts a retried message back to pending", () => {
    const failed = setOutgoingState(list, "a", "failed");
    expect(setOutgoingState(failed, "a", "pending")[0]?.state).toBe("pending");
  });
});
