import { describe, expect, it } from "vitest";
import {
  publishLocalMedia,
  switchActiveMedia,
  type LocalMedia,
} from "./localMedia";

function recorder() {
  const calls: unknown[][] = [];
  const local: LocalMedia = {
    setMicrophoneEnabled: async (...args) => {
      calls.push(["mic", ...args]);
      return args[0] ? { source: "microphone" } : undefined;
    },
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

  it("does not report a joined call when the microphone failed to publish", async () => {
    const local: LocalMedia = {
      setMicrophoneEnabled: async () => undefined,
      setCameraEnabled: async () => undefined,
    };
    await expect(
      publishLocalMedia(local, {
        withMic: true,
        microphoneId: "m1",
        withCamera: false,
        cameraId: "",
      }),
    ).rejects.toThrow("microphone publication failed");
  });
});

describe("switchActiveMedia", () => {
  it("changes the live microphone and camera without republishing the call", async () => {
    const calls: unknown[][] = [];
    const room = {
      switchActiveDevice: async (...args: unknown[]) => {
        calls.push(args);
        return true;
      },
    };

    await switchActiveMedia(room, "audioinput", "mic-2");
    await switchActiveMedia(room, "videoinput", "cam-2");

    expect(calls).toEqual([
      ["audioinput", "mic-2", true],
      ["videoinput", "cam-2", true],
    ]);
  });

  it("uses the browser default device when the selection is empty", async () => {
    const calls: unknown[][] = [];
    const room = {
      switchActiveDevice: async (...args: unknown[]) => {
        calls.push(args);
        return true;
      },
    };

    await switchActiveMedia(room, "audioinput", "");

    expect(calls).toEqual([["audioinput", "default", false]]);
  });

  it("rejects when the browser cannot activate the selected device", async () => {
    const room = { switchActiveDevice: async () => false };
    await expect(
      switchActiveMedia(room, "videoinput", "missing"),
    ).rejects.toThrow("device switch failed");
  });
});
