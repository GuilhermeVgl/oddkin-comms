import { describe, expect, it } from "vitest";
import { avatarUrl, centerSquare, setAvatarVersions } from "./avatars";

describe("avatar helpers", () => {
  it("cuts the biggest square from the middle", () => {
    expect(centerSquare(1000, 600)).toEqual({ x: 200, y: 0, side: 600 });
    expect(centerSquare(300, 900)).toEqual({ x: 0, y: 300, side: 300 });
    expect(centerSquare(256, 256)).toEqual({ x: 0, y: 0, side: 256 });
  });

  it("asks for a changed photo by its version", () => {
    expect(avatarUrl("abc", 3)).toBe("/api/v1/accounts/abc/avatar?v=3");
    expect(() =>
      setAvatarVersions([{ accountId: "abc", version: 3 }]),
    ).not.toThrow();
  });
});
