import { describe, expect, it } from "vitest";
import {
  cameraOptions,
  canPublishScreen,
  levelsFromSpectrum,
  microphoneOptions,
  previewConstraints,
  restingLevels,
} from "./media";

describe("previewConstraints", () => {
  it("asks for the defaults when nothing was chosen", () => {
    expect(
      previewConstraints({ microphoneId: "", cameraId: "" }, true),
    ).toEqual({ audio: true, video: true });
  });

  it("pins the chosen devices", () => {
    expect(
      previewConstraints({ microphoneId: "m1", cameraId: "c1" }, true),
    ).toEqual({ audio: { deviceId: "m1" }, video: { deviceId: "c1" } });
  });

  it("drops the video when the camera is off, whatever was chosen", () => {
    expect(
      previewConstraints({ microphoneId: "", cameraId: "c1" }, false),
    ).toEqual({ audio: true, video: false });
  });
});

describe("device options", () => {
  it("leaves the microphone to the browser unless one is chosen", () => {
    expect(microphoneOptions("")).toBeUndefined();
    expect(microphoneOptions("m1")).toEqual({ deviceId: "m1" });
  });

  it("always asks the camera for 720p at 30 fps", () => {
    expect(cameraOptions("")).toEqual({
      resolution: { width: 1280, height: 720, frameRate: 30 },
    });
    expect(cameraOptions("c1")).toEqual({
      deviceId: "c1",
      resolution: { width: 1280, height: 720, frameRate: 30 },
    });
  });
});

describe("level meter", () => {
  it("rests low", () => {
    expect(restingLevels(3)).toEqual([0.1, 0.1, 0.1]);
  });

  it("scales the spectrum, clamped between 0.1 and 1, skipping bin zero", () => {
    const levels = levelsFromSpectrum([255, 0, 128, 255], 4);
    expect(levels[0]).toBe(0.1);
    expect(levels[1]).toBeCloseTo((128 / 255) * 1.4);
    expect(levels[2]).toBe(1);
    // beyond the data it repeats the last bin
    expect(levels[3]).toBe(1);
  });

  it("copes with an empty spectrum", () => {
    expect(levelsFromSpectrum([], 2)).toEqual([0.1, 0.1]);
  });
});

describe("canPublishScreen", () => {
  it("treats an empty list as every source", () => {
    expect(canPublishScreen([])).toBe(true);
  });

  it("accepts the screen-share source, numeric or not", () => {
    expect(canPublishScreen([1, 3])).toBe(true);
    expect(canPublishScreen(["3"])).toBe(true);
  });

  it("refuses a list without it", () => {
    expect(canPublishScreen([1, 2])).toBe(false);
  });
});
