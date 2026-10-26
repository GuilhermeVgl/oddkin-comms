import { describe, expect, it } from "vitest";
import { publishLocalMedia, type LocalMedia } from "./localMedia";

function recorder() {
  const calls: unknown[][] = [];
  const local: LocalMedia = {
    setMicrophoneEnabled: async (...args) => void calls.push(["mic", ...args]),
    setCameraEnabled: async (...args) => void calls.push(["cam", ...args]),
  };
  return { calls, local };
}

describe("publishLocalMedia", () => {
  it("publishes the microphone then the camera with the chosen devices", async () => {
    const { calls, local } = recorder();
    await publishLocalMedia(local, {
      withMic: true,
      microphoneId: "m1",
      withCamera: true,
      cameraId: "c1",
    });
    expect(calls).toEqual([
      ["mic", true, { deviceId: "m1" }],
      [
        "cam",
        true,
        {
          deviceId: "c1",
          resolution: { width: 1280, height: 720, frameRate: 30 },
        },
      ],
    ]);
  });

  it("still tells the microphone it is off, and skips a camera that was off", async () => {
    const { calls, local } = recorder();
    await publishLocalMedia(local, {
      withMic: false,
      microphoneId: "",
      withCamera: false,
      cameraId: "",
    });
    expect(calls).toEqual([["mic", false, undefined]]);
  });
});
