import type { createApiClient } from "@crewstead/api-client";

export type Client = ReturnType<typeof createApiClient>;

/** Whether the browser can encrypt and decrypt media frames (insertable streams or script transforms). */
export function supportsMediaE2EE(): boolean {
  const sender = globalThis.RTCRtpSender?.prototype as
    { createEncodedStreams?: unknown } | undefined;
  const transform = globalThis as typeof globalThis & {
    RTCRtpScriptTransform?: unknown;
  };
  return (
    typeof sender?.createEncodedStreams === "function" ||
    typeof transform.RTCRtpScriptTransform === "function"
  );
}

export function e2eeWorker(): Worker {
  return new Worker(new URL("livekit-client/e2ee-worker", import.meta.url), {
    type: "module",
  });
}

export function keyBuffer(key: Uint8Array): ArrayBuffer {
  return Uint8Array.from(key).buffer;
}
