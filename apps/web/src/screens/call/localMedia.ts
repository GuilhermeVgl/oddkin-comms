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
  await local.setMicrophoneEnabled(
    choice.withMic,
    microphoneOptions(choice.microphoneId),
  );
  if (choice.withCamera) {
    await local.setCameraEnabled(true, cameraOptions(choice.cameraId));
  }
}
