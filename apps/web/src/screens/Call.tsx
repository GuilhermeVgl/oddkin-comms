import type { Room } from "livekit-client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOptionalE2EE } from "../e2ee/E2EE";
import { useInbox } from "../inbox";
import { useWorkspace } from "../workspace";
import { callTitle } from "./call/callView";
import { CallError } from "./call/CallError";
import { ConnectedStage } from "./call/ConnectedStage";
import { supportsMediaE2EE, type Client } from "./call/environment";
import { PrejoinPanel } from "./call/PrejoinPanel";
import { useCallState } from "./call/useCallState";
import { usePrejoin } from "./call/usePrejoin";
import { useRoomConnection, type RoomPhase } from "./call/useRoomConnection";
import { useScreenShare } from "./call/useScreenShare";

/** Closes the call screen on Escape while enabled and no menu or dialog is open. */
function useEscapeToClose(enabled: boolean, onClose: () => void) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        enabled &&
        document.querySelector(".menu, dialog[open]") === null
      )
        onClose();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [enabled, onClose]);
}

/** The full-screen call: preview, then the grid of people with the call controls. */
export function CallRoom({
  client,
  callId,
  onClose,
}: {
  client: Client;
  callId: string;
  onClose: () => void;
}) {
  const e2ee = useOptionalE2EE();
  const { channels, dms } = useInbox();
  const { people } = useWorkspace();
  const [phase, setPhase] = useState<RoomPhase>("preview");
  const [message, setMessage] = useState("");
  const room = useRef<Room | null>(null);
  const supported = supportsMediaE2EE();
  const unlocked = e2ee?.phase === "unlocked";
  const encryptionReady = unlocked && supported;

  const { call, setCall } = useCallState(client, callId, setMessage);
  const prejoin = usePrejoin(phase === "preview", setMessage);
  const screen = useScreenShare({ client, callId, room, setMessage });
  const connection = useRoomConnection({
    client,
    callId,
    call,
    setCall,
    setMessage,
    phase,
    setPhase,
    e2ee,
    encryptionReady,
    media: {
      withMic: prejoin.withMic,
      microphoneId: prejoin.microphoneId,
      withCamera: prejoin.withCamera,
      cameraId: prejoin.cameraId,
    },
    room,
    onLocalUnpublished: screen.handleLocalUnpublished,
    resetScreenShare: () => screen.setSharing(false),
    onClose,
  });
  useEscapeToClose(phase === "preview", onClose);

  const title = useMemo(
    () => callTitle(call, channels, dms),
    [call, channels, dms],
  );
  const isExternal = (identity: string) => {
    for (const person of people.values()) {
      if (person.id === identity || person.email === identity)
        return person.external;
    }
    return false;
  };

  const stage = (
    <div
      aria-label={`Chamada: ${title}`}
      aria-modal="true"
      className="stage"
      id="stage"
      role="dialog"
    >
      {phase === "preview" || phase === "joining" ? (
        <PrejoinPanel
          call={call}
          encryptionReady={encryptionReady}
          joining={phase === "joining"}
          message={message}
          needsTransfer={connection.needsTransfer}
          onClose={onClose}
          onJoin={(transfer) => void connection.join(transfer)}
          prejoin={prejoin}
          supported={supported}
          title={title}
          unlocked={unlocked}
        />
      ) : null}
      {phase === "connected" ? (
        <ConnectedStage
          call={call}
          controls={{
            muted: connection.muted,
            cameraOn: connection.cameraOn,
            sharing: screen.sharing,
            shareAudio: screen.shareAudio,
            canEnd: call?.canEnd,
            onToggleMicrophone: connection.toggleMicrophone,
            onToggleCamera: connection.toggleCamera,
            onToggleScreen: () => void screen.toggleScreen(),
            onSwitchScreen: () => void screen.toggleScreen(true),
            onToggleShareAudio: screen.toggleShareAudio,
            onLeave: (everyone) => void connection.leave(everyone),
          }}
          isExternal={isExternal}
          message={message}
          participants={connection.participants}
          since={connection.since}
          title={title}
        />
      ) : null}
      {phase === "error" ? (
        <CallError
          message={message}
          onClose={onClose}
          onRetry={() => setPhase("preview")}
        />
      ) : null}
    </div>
  );

  return createPortal(stage, document.body);
}
