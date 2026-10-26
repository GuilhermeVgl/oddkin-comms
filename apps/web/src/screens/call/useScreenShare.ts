import { startScreenShare, stopScreenShare } from "@crewstead/api-client";
import {
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type Room,
} from "livekit-client";
import { useRef, useState, type MutableRefObject } from "react";
import { blip } from "../../design/sound";
import type { Client } from "./environment";
import { canPublishScreen } from "./media";
import { describeShareError } from "./messages";

/**
 * The server grants the screen with a permission update that reaches the
 * browser a moment after its answer; publishing before it arrives is refused.
 */
function waitForScreenPermission(room: Room, timeoutMs = 6000): Promise<void> {
  const allowed = () =>
    canPublishScreen(
      room.localParticipant.permissions?.canPublishSources ?? [],
    );
  if (allowed()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      room.off(RoomEvent.ParticipantPermissionsChanged, check);
      reject(new Error("screen_permission_timeout"));
    }, timeoutMs);
    function check() {
      if (!allowed()) return;
      clearTimeout(timer);
      room.off(RoomEvent.ParticipantPermissionsChanged, check);
      resolve();
    }
    room.on(RoomEvent.ParticipantPermissionsChanged, check);
  });
}

/**
 * Opens the browser's picker and publishes the chosen screen (with its sound
 * when asked). Only whole screens are accepted: the picker is told to start on
 * screens, and a window or tab is refused afterwards because browsers cannot
 * hide those from the list.
 */
async function publishScreen(active: Room, withSound: boolean) {
  await active.localParticipant.setScreenShareEnabled(true, {
    audio: withSound,
    systemAudio: withSound ? "include" : "exclude",
    video: { displaySurface: "monitor" },
    selfBrowserSurface: "exclude",
    surfaceSwitching: "exclude",
    resolution: { width: 1920, height: 1080, frameRate: 15 },
  });
  const track = active.localParticipant.getTrackPublication(
    Track.Source.ScreenShare,
  )?.track;
  const surface = track?.mediaStreamTrack.getSettings().displaySurface;
  if (surface !== undefined && surface !== "monitor") {
    await active.localParticipant.setScreenShareEnabled(false);
    throw new Error("monitor_only");
  }
}

/** Starting, stopping and switching the screen share; the server arbitrates the single slot. */
export function useScreenShare(input: {
  client: Client;
  callId: string;
  room: MutableRefObject<Room | null>;
  setMessage: (message: string) => void;
}) {
  const { client, callId, room, setMessage } = input;
  const [sharing, setSharing] = useState(false);
  const [shareAudio, setShareAudio] = useState(false);
  // Changing screens unpublishes the old capture on purpose; that must not give the slot away.
  const switching = useRef(false);

  /** "Stop sharing" in the browser's own bar: give the slot back. */
  function handleLocalUnpublished(publication: LocalTrackPublication) {
    if (publication.source !== Track.Source.ScreenShare) return;
    if (switching.current) return;
    setSharing(false);
    void stopScreenShare(client, callId).catch(() => undefined);
  }

  async function toggleScreen(switchScreen = false) {
    const active = room.current;
    if (active === null) return;
    try {
      if (sharing && !switchScreen) {
        await active.localParticipant.setScreenShareEnabled(false);
        await stopScreenShare(client, callId);
        setSharing(false);
        return;
      }
      if (sharing && switchScreen) {
        // Same slot, another screen: the presenter keeps the permission, so
        // only the capture is replaced.
        switching.current = true;
        try {
          await active.localParticipant.setScreenShareEnabled(false);
          await publishScreen(active, shareAudio);
        } finally {
          switching.current = false;
        }
        setMessage("");
        return;
      }
      // The server arbitrates the single slot and then lets LiveKit accept the
      // screen from this person, so they stay in the room: reconnecting would
      // make the server see them leave.
      await startScreenShare(client, callId);
      try {
        await waitForScreenPermission(active);
        await publishScreen(active, shareAudio);
      } catch (error) {
        // The picker was cancelled or the browser refused: free the slot again.
        await stopScreenShare(client, callId).catch(() => undefined);
        throw error;
      }
      setSharing(true);
      setMessage("");
      blip("ok");
    } catch (error) {
      if (switchScreen) {
        // The old capture is already gone; the slot is still ours.
        await stopScreenShare(client, callId).catch(() => undefined);
      }
      setSharing(false);
      setMessage(describeShareError(error));
    }
  }

  return {
    sharing,
    setSharing,
    shareAudio,
    toggleShareAudio: () => setShareAudio((value) => !value),
    toggleScreen,
    handleLocalUnpublished,
  };
}

export type ScreenShare = ReturnType<typeof useScreenShare>;
