import { describe, expect, it } from "vitest";
import { mentionNames, mentionedAccountIds } from "./mentions";

const members = [
  { accountId: "a1", email: "ana.souza@crewstead.test" },
  { accountId: "b2", email: "bruno@crewstead.test" },
];

describe("mentions", () => {
  it("lists the first names people can be mentioned by", () => {
    expect([...mentionNames(members)].sort()).toEqual(["Ana", "Bruno"]);
  });

  it("finds the accounts a message mentions by first name", () => {
    expect(mentionedAccountIds(members, "oi @Ana, tudo bem?")).toEqual(["a1"]);
    expect(mentionedAccountIds(members, "@Bruno e @Ana")).toEqual(["a1", "b2"]);
  });

  it("ignores names written without the @", () => {
    expect(mentionedAccountIds(members, "Ana e Bruno")).toEqual([]);
  });
});
