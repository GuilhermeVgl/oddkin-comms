/** Pure choices about what to capture and how to show it. */

export type DeviceChoice = { microphoneId: string; cameraId: string };

/** What the preview asks the browser for before joining. */
export function previewConstraints(
  choice: DeviceChoice,
  withCamera: boolean,
): MediaStreamConstraints {
  return {
    audio:
      choice.microphoneId === "" ? true : { deviceId: choice.microphoneId },
    video: withCamera
      ? choice.cameraId === ""
        ? true
        : { deviceId: choice.cameraId }
      : false,
  };
}

/** The device to publish from, or nothing for the browser's default. */
export function microphoneOptions(
  microphoneId: string,
): { deviceId: string } | undefined {
  return microphoneId === "" ? undefined : { deviceId: microphoneId };
}

const CAMERA_RESOLUTION = { width: 1280, height: 720, frameRate: 30 };

export function cameraOptions(cameraId: string) {
  return cameraId === ""
    ? { resolution: CAMERA_RESOLUTION }
    : { deviceId: cameraId, resolution: CAMERA_RESOLUTION };
}

/** Level meter bars at rest, before any audio arrives. */
export function restingLevels(bars: number): number[] {
  return Array.from({ length: bars }, () => 0.1);
}

/** Bar heights (0.1 to 1) from an analyser's byte spectrum. */
export function levelsFromSpectrum(
  data: ArrayLike<number>,
  bars: number,
): number[] {
  return Array.from({ length: bars }, (_, index) => {
    const value = (data[Math.min(data.length - 1, index + 1)] ?? 0) / 255;
    return Math.max(0.1, Math.min(1, value * 1.4));
  });
}

/** LiveKit's numeric TrackSource for a shared screen (livekit.TrackSource.SCREEN_SHARE). */
export const SCREEN_SHARE_SOURCE = 3;

/** An empty list of publishable sources means "every source". */
export function canPublishScreen(sources: readonly unknown[]): boolean {
  return (
    sources.length === 0 ||
    sources.some((source) => Number(source) === SCREEN_SHARE_SOURCE)
  );
}
