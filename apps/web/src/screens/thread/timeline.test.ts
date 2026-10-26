import type { CallRecord, Message } from "@crewstead/api-client";
import { describe, expect, it } from "vitest";
import { fmtLong } from "../../design/format";
import {
  buildTimeline,
  dayLabel,
  filterMessages,
  firstUnreadIndex,
  latestSeq,
  mergeMessages,
} from "./timeline";

const message = (
  id: string,
  seq: number,
  createdAt = "2026-10-20T12:00:00Z",
  body = id,
): Message => ({ id, seq, createdAt, body }) as Message;

const call = (id: string, startedAt: string): CallRecord =>
  ({ id, startedAt }) as CallRecord;

describe("merging messages", () => {
  it("keeps messages ordered by sequence", () => {
    const merged = mergeMessages([message("b", 2)], [message("a", 1)]);
    expect(merged.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("replaces a message that arrives again, so edits and reactions show up", () => {
    const merged = mergeMessages(
      [message("a", 1, undefined, "antes")],
      [message("a", 1, undefined, "depois")],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.body).toBe("depois");
  });

  it("tracks the highest sequence seen", () => {
    expect(latestSeq(5, [message("a", 3), message("b", 9)])).toBe(9);
    expect(latestSeq(5, [message("a", 3)])).toBe(5);
    expect(latestSeq(5, [])).toBe(5);
  });
});

describe("searching messages", () => {
  const list = [message("a", 1, undefined, "Reunião às 10"), message("b", 2)];

  it("shows everything for an empty search", () => {
    expect(filterMessages(list, "   ")).toBe(list);
  });

  it("matches the body without caring about case or surrounding spaces", () => {
    expect(filterMessages(list, "  REUNIÃO ").map((entry) => entry.id)).toEqual(
      ["a"],
    );
  });
});

describe("the unread separator", () => {
  it("sits before the messages that were unread when the thread opened", () => {
    expect(firstUnreadIndex(10, 3)).toBe(7);
  });

  it("is absent when nothing was unread", () => {
    expect(firstUnreadIndex(10, 0)).toBe(-1);
  });
});

describe("day labels", () => {
  const now = new Date("2026-10-26T15:00:00");

  it("says Hoje for today", () => {
    expect(dayLabel("2026-10-26T08:00:00", now)).toBe("Hoje");
  });

  it("spells out any other day", () => {
    expect(dayLabel("2026-10-20T12:00:00", now)).toBe(
      fmtLong(new Date("2026-10-20T12:00:00")),
    );
  });
});

describe("the conversation timeline", () => {
  const now = new Date("2026-10-26T15:00:00");
  const messages = [
    message("m1", 1, "2026-10-20T10:00:00"),
    message("m2", 2, "2026-10-20T11:00:00"),
    message("m3", 3, "2026-10-21T09:00:00"),
  ];

  it("labels only the first entry of each day", () => {
    const timeline = buildTimeline(messages, [], { searching: false, now });
    expect(timeline.map((entry) => entry.day !== null)).toEqual([
      true,
      false,
      true,
    ]);
    expect(timeline.map((entry) => entry.kind)).toEqual([
      "message",
      "message",
      "message",
    ]);
  });

  it("places each call between the messages around its start, oldest history first", () => {
    // The API lists the newest call first.
    const history = [
      call("late", "2026-10-21T10:00:00"),
      call("mid", "2026-10-20T10:30:00"),
    ];
    const timeline = buildTimeline(messages, history, {
      searching: false,
      now,
    });
    expect(
      timeline.map((entry) =>
        entry.kind === "call" ? entry.record.id : entry.message.id,
      ),
    ).toEqual(["m1", "mid", "m2", "m3", "late"]);
  });

  it("keeps the position of each message among the shown ones", () => {
    const timeline = buildTimeline(
      messages,
      [call("c", "2026-10-20T10:30:00")],
      {
        searching: false,
        now,
      },
    );
    const indexes = timeline.flatMap((entry) =>
      entry.kind === "message" ? [entry.index] : [],
    );
    expect(indexes).toEqual([0, 1, 2]);
  });

  it("leaves calls out while searching", () => {
    const timeline = buildTimeline(
      messages,
      [call("c", "2026-10-20T10:30:00")],
      {
        searching: true,
        now,
      },
    );
    expect(timeline.every((entry) => entry.kind === "message")).toBe(true);
  });

  it("labels a call that starts a new day", () => {
    const timeline = buildTimeline([], [call("c", "2026-10-26T08:00:00")], {
      searching: false,
      now,
    });
    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.day).toBe("Hoje");
  });
});
