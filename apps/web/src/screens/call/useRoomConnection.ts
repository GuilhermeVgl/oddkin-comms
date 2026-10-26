import {
  endCall,
  getCall,
  joinCall,
  leaveCall,
  type Call,
  type CallTicket,
} from "@crewstead/api-client";
import {
  ExternalE2EEKeyProvider,
  Room,
  RoomEvent,
  type LocalTrackPublication,
  type Participant,
} from "livekit-client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { blip } from "../../design/sound";
import type { E2EEApi } from "../../e2ee/E2EE";
import { e2eeWorker, keyBuffer, readCsrf, type Client } from "./environment";
import { publishLocalMedia } from "./localMedia";
import { describeJoinError, isOtherDeviceConflict } from "./messages";

export type RoomPhase = "preview" | "joining" | "connected" | "error";

type MediaChoice = {
  withMic: boolean;
  microphoneId: string;
  withCamera: boolean;
  cameraId: string;
};

/**
 * The LiveKit room and the ephemeral media key that encrypts it: joining,
 * following key rotations, the local microphone and camera, and leaving. Media
 * never flows before the key is in place; losing the key suspends the call.
 */
export function useRoomConnection(input: {
  client: Client;
  callId: string;
  call: Call | null;
  setCall: (call: Call) => void;
  setMessage: (message: string) => void;
  phase: RoomPhase;
  setPhase: Dispatch<SetStateAction<RoomPhase>>;
  e2ee: E2EEApi | null;
  encryptionReady: boolean;
  media: MediaChoice;
  room: MutableRefObject<Room | null>;
  onLocalUnpublished: (publication: LocalTrackPublication) => void;
  resetScreenShare: () => void;
  onClose: () => void;
}) {
  const {
    client,
    callId,
    call,
    setCall,
    setMessage,
    phase,
    setPhase,
    e2ee,
    encryptionReady,
    media,
    room,
    onLocalUnpublished,
    resetScreenShare,
    onClose,
  } = input;
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [needsTransfer, setNeedsTransfer] = useState(false);
  const [since, setSince] = useState(0);
  const mediaKey = useRef<Uint8Array | null>(null);
  const keyProvider = useRef<ExternalE2EEKeyProvider | null>(null);

  const syncParticipants = useCallback(() => {
    const current = room.current;
    if (current === null) return;
    setParticipants([
      current.localParticipant,
      ...current.remoteParticipants.values(),
    ]);
  }, [room]);

  async function provisionMediaKey(nextCall: Call): Promise<Uint8Array> {
    if (e2ee?.phase !== "unlocked") throw new Error("unlock_required");
    const crypto = await e2ee.openCall(nextCall.id);
    if (crypto === null) throw new Error("unlock_required");
    const key = await crypto.keyFor(nextCall);
    mediaKey.current = key;
    if (keyProvider.current !== null) {
      await keyProvider.current.setKey(keyBuffer(key));
    }
    return key;
  }

  async function connect(ticket: CallTicket) {
    const key = mediaKey.current;
    if (key === null) throw new Error("media_key_missing");
    const provider = new ExternalE2EEKeyProvider({ keySize: 256 });
    await provider.setKey(keyBuffer(key));
    const worker = e2eeWorker();
    const next = new Room({
      adaptiveStream: true,
      dynacast: true,
      e2ee: { keyProvider: provider, worker },
    });
    room.current = next;
    keyProvider.current = provider;
    next
      .on(RoomEvent.ParticipantConnected, syncParticipants)
      .on(RoomEvent.ParticipantDisconnected, syncParticipants)
      .on(RoomEvent.TrackSubscribed, syncParticipants)
      .on(RoomEvent.EncryptionError, () => {
        next.disconnect();
        setMessage(
          "A criptografia da chamada falhou. Nenhuma mídia foi enviada.",
        );
        setPhase("error");
      })
      .on(RoomEvent.LocalTrackUnpublished, onLocalUnpublished)
      .on(RoomEvent.Disconnected, () =>
        setPhase((value) => (value === "connected" ? "error" : value)),
      );
    await next.connect(ticket.url, ticket.token);
    await next.setE2EEEnabled(true);
    await publishLocalMedia(next.localParticipant, media);
    setMuted(!media.withMic);
    setCameraOn(media.withCamera);
    resetScreenShare();
    syncParticipants();
  }

  async function join(transfer: boolean) {
    const token = readCsrf();
    if (token === null) return;
    setPhase("joining");
    setMessage("");
    try {
      if (!encryptionReady || e2ee === null)
        throw new Error("e2ee_unavailable");
      const device = await e2ee.openCall(callId);
      if (device === null) throw new Error("unlock_required");
      const ticket = await joinCall(
        client,
        token,
        callId,
        device.deviceId,
        transfer,
      );
      const active = await getCall(client, callId);
      setCall(active);
      await provisionMediaKey(active);
      await connect(ticket);
      setSince(Date.now());
      setPhase("connected");
      blip("ok");
    } catch (error) {
      room.current?.disconnect();
      room.current = null;
      setNeedsTransfer(isOtherDeviceConflict(error));
      setMessage(describeJoinError(error));
      blip("err");
      setPhase("preview");
    }
  }

  // A new key generation (someone left, or the key is still arriving) must be
  // in place before anything more is published.
  useEffect(() => {
    if (phase !== "connected" || call === null) return;
    void provisionMediaKey(call).catch(() => {
      room.current?.disconnect();
      setMessage(
        "A nova chave de mídia não foi confirmada. A chamada foi suspensa.",
      );
      setPhase("error");
    });
  }, [call?.id, call?.keyGeneration, call?.keyState, phase]);

  useEffect(
    () => () => {
      room.current?.disconnect();
      keyProvider.current = null;
      mediaKey.current = null;
    },
    [],
  );

  async function leave(everyone: boolean) {
    const token = readCsrf();
    room.current?.disconnect();
    room.current = null;
    keyProvider.current = null;
    mediaKey.current = null;
    if (token !== null) {
      await (
        everyone
          ? endCall(client, token, callId)
          : leaveCall(client, token, callId)
      ).catch(() => undefined);
    }
    onClose();
  }

  function toggleMicrophone() {
    const next = !muted;
    void room.current?.localParticipant
      .setMicrophoneEnabled(!next)
      .then(() => setMuted(next));
  }

  function toggleCamera() {
    const next = !cameraOn;
    void room.current?.localParticipant
      .setCameraEnabled(next)
      .then(() => setCameraOn(next));
  }

  return {
    participants,
    muted,
    cameraOn,
    needsTransfer,
    since,
    join,
    leave,
    toggleMicrophone,
    toggleCamera,
  };
}
