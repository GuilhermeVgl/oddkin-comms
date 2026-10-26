import { describe, expect, it } from "vitest";
import { idsAfterDrop, idsAfterMove } from "./channelOrder";

describe("idsAfterMove", () => {
  const ids = ["a", "b", "c"];
  it("moves a channel up or down by one", () => {
    expect(idsAfterMove(ids, "b", -1)).toEqual(["b", "a", "c"]);
    expect(idsAfterMove(ids, "b", 1)).toEqual(["a", "c", "b"]);
  });
  it("returns null when the move leaves the list or the id is unknown", () => {
    expect(idsAfterMove(ids, "a", -1)).toBeNull();
    expect(idsAfterMove(ids, "c", 1)).toBeNull();
    expect(idsAfterMove(ids, "zzz", 1)).toBeNull();
  });
  it("does not change the input", () => {
    idsAfterMove(ids, "b", 1);
    expect(ids).toEqual(["a", "b", "c"]);
  });
});

describe("idsAfterDrop", () => {
  const ids = ["a", "b", "c", "d"];
  it("puts the dragged channel before or after the target", () => {
    expect(idsAfterDrop(ids, "d", "b", false)).toEqual(["a", "d", "b", "c"]);
    expect(idsAfterDrop(ids, "a", "c", true)).toEqual(["b", "c", "a", "d"]);
  });
  it("ignores dropping on nothing or on itself", () => {
    expect(idsAfterDrop(ids, null, "b", false)).toBeNull();
    expect(idsAfterDrop(ids, "b", "b", true)).toBeNull();
  });
});
