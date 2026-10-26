import { describe, expect, it } from "vitest";
import {
  MAX_ZOOM,
  avatarUrl,
  cropRect,
  initialFraming,
  panFraming,
  rotateFraming,
  setAvatarVersions,
  zoomFraming,
} from "./avatars";

describe("avatar helpers", () => {
  it("asks for a changed photo by its version", () => {
    expect(avatarUrl("abc", 3)).toBe("/api/v1/accounts/abc/avatar?v=3");
    expect(() =>
      setAvatarVersions([{ accountId: "abc", version: 3 }]),
    ).not.toThrow();
  });
});

describe("photo framing", () => {
  it("starts with the biggest square from the middle", () => {
    expect(cropRect(1000, 600, initialFraming())).toEqual({
      x: 200,
      y: 0,
      side: 600,
    });
    expect(cropRect(300, 900, initialFraming())).toEqual({
      x: 0,
      y: 300,
      side: 300,
    });
    expect(cropRect(256, 256, initialFraming())).toEqual({
      x: 0,
      y: 0,
      side: 256,
    });
  });

  it("zooming in shrinks the square around the same centre", () => {
    const framing = zoomFraming(initialFraming(), 2);
    expect(cropRect(1000, 600, framing)).toEqual({ x: 350, y: 150, side: 300 });
  });

  it("never zooms out past the whole photo or in past the limit", () => {
    expect(zoomFraming(initialFraming(), 0.2).zoom).toBe(1);
    expect(zoomFraming(initialFraming(), 99).zoom).toBe(MAX_ZOOM);
  });

  it("dragging moves the photo, so the square goes the other way", () => {
    // 300 px view of a 300 px square: one view pixel is one photo pixel.
    const zoomed = zoomFraming(initialFraming(), 2);
    const dragged = panFraming(1000, 600, zoomed, 50, 0, 300);
    // The photo moved right by 50 px, so the square now starts 50 px further left.
    expect(cropRect(1000, 600, dragged)).toEqual({ x: 300, y: 150, side: 300 });
  });

  it("keeps the square inside the photo however far it is dragged", () => {
    const zoomed = zoomFraming(initialFraming(), 2);
    const far = panFraming(1000, 600, zoomed, -100000, 100000, 300);
    const rect = cropRect(1000, 600, far);
    expect(rect.x).toBe(700);
    expect(rect.y).toBe(0);
    expect(rect.x + rect.side).toBeLessThanOrEqual(1000);
    expect(rect.y + rect.side).toBeLessThanOrEqual(600);
  });

  it("a turned photo swaps its sides", () => {
    const turned = rotateFraming(initialFraming(), 1);
    expect(turned.quarterTurns).toBe(1);
    expect(cropRect(1000, 600, turned)).toEqual({ x: 0, y: 200, side: 600 });
    expect(rotateFraming(turned, -2).quarterTurns).toBe(3);
    expect(rotateFraming(rotateFraming(turned, 3), 0).quarterTurns).toBe(0);
  });
});
