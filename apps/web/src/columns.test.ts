import type { BoardColumn } from "@crewstead/api-client";
import { describe, expect, it } from "vitest";
import { doneColumn, isDone, reopenColumn, startColumn } from "./columns";

const column = (id: string, category: BoardColumn["category"]): BoardColumn =>
  ({ id, name: id, category, position: 0 }) as BoardColumn;

const board = [
  column("a", "todo"),
  column("b", "in_progress"),
  column("c", "in_progress"),
  column("d", "done"),
];

describe("board column helpers", () => {
  it("knows which cards are done", () => {
    expect(isDone(board, "d")).toBe(true);
    expect(isDone(board, "a")).toBe(false);
    expect(isDone(board, "missing")).toBe(false);
  });

  it("finds the column for finished work", () => {
    expect(doneColumn(board)?.id).toBe("d");
    expect(doneColumn([column("a", "todo")])).toBeUndefined();
  });

  it("starts in the first to-do column, or the first column when none is marked", () => {
    expect(startColumn(board)?.id).toBe("a");
    expect(
      startColumn([column("x", "in_progress"), column("y", "done")])?.id,
    ).toBe("x");
  });

  it("reopens into the first in-progress column, falling back to the first", () => {
    expect(reopenColumn(board)?.id).toBe("b");
    expect(reopenColumn([column("x", "todo"), column("y", "done")])?.id).toBe(
      "x",
    );
    expect(reopenColumn([])).toBeUndefined();
  });
});
