import { cameraOptions, microphoneOptions } from "./media";

/** The part of a LiveKit local participant that publishing the mic and camera needs. */
export type LocalMedia = {
  setMicrophoneEnabled(
    enabled: boolean,
    options?: { deviceId: string },
  ): Promise<unknown>;
  setCameraEnabled(
    enabled: boolean,
    options?: {
      deviceId?: string;
      resolution: { width: number; height: number; frameRate: number };
    },
  ): Promise<unknown>;
};

export type ActiveMediaRoom = {
  switchActiveDevice(
    kind: "audioinput" | "videoinput",
    deviceId: string,
    exact: boolean,
  ): Promise<boolean>;
};

/** Changes a live input in place; an empty selection means the browser default. */
export async function switchActiveMedia(
  room: ActiveMediaRoom,
  kind: "audioinput" | "videoinput",
  deviceId: string,
): Promise<void> {
  const selected = deviceId === "" ? "default" : deviceId;
  const switched = await room.switchActiveDevice(
    kind,
    selected,
    deviceId !== "",
  );
  if (!switched) throw new Error("device switch failed");
}

/** Publishes the microphone, then the camera when it was on in the preview. */
export async function publishLocalMedia(
  local: LocalMedia,
  choice: {
    withMic: boolean;
    microphoneId: string;
    withCamera: boolean;
    cameraId: string;
  },
): Promise<void> {
  const microphone = await local.setMicrophoneEnabled(
    choice.withMic,
    microphoneOptions(choice.microphoneId),
  );
  if (choice.withMic && microphone === undefined)
    throw new Error("microphone publication failed");
  if (choice.withCamera) {
    await local.setCameraEnabled(true, cameraOptions(choice.cameraId));
  }
}
