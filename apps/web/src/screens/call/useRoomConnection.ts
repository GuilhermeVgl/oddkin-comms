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
  MediaDeviceFailure,
  Room,
  RoomEvent,
  Track,
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
import { e2eeWorker, keyBuffer, type Client } from "./environment";
import { publishLocalMedia, switchActiveMedia } from "./localMedia";
import { microphoneOptions } from "./media";
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
  setMicrophoneId: (deviceId: string) => void;
  setCameraId: (deviceId: string) => void;
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
    setMicrophoneId: rememberMicrophone,
    setCameraId: rememberCamera,
    room,
    onLocalUnpublished,
    resetScreenShare,
    onClose,
  } = input;
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [microphoneId, setActiveMicrophoneId] = useState(media.microphoneId);
  const [cameraId, setActiveCameraId] = useState(media.cameraId);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [needsTransfer, setNeedsTransfer] = useState(false);
  const [since, setSince] = useState(0);
  const mediaKey = useRef<Uint8Array | null>(null);
  const keyProvider = useRef<ExternalE2EEKeyProvider | null>(null);

  function describeDeviceError(error: Error, kind?: MediaDeviceKind): string {
    const device =
      kind === "videoinput"
        ? "a câmera"
        : kind === "audioinput"
          ? "o microfone"
          : "o dispositivo de mídia";
    switch (MediaDeviceFailure.getFailure(error)) {
      case MediaDeviceFailure.PermissionDenied:
        return `O navegador bloqueou ${device}. Libere a permissão e tente novamente.`;
      case MediaDeviceFailure.NotFound:
        return `Não foi possível encontrar ${device}. Escolha outro dispositivo.`;
      case MediaDeviceFailure.DeviceInUse:
        return `${device[0]?.toLocaleUpperCase("pt-BR")}${device.slice(1)} está sendo usado por outro aplicativo. Feche-o e tente novamente.`;
      default:
        return `Não foi possível usar ${device}. Verifique o dispositivo e a permissão do navegador.`;
    }
  }

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
      .on(RoomEvent.TrackMuted, (publication, participant) => {
        if (
          participant.isLocal &&
          publication.source === Track.Source.Microphone
        )
          setMuted(true);
      })
      .on(RoomEvent.TrackUnmuted, (publication, participant) => {
        if (
          participant.isLocal &&
          publication.source === Track.Source.Microphone
        )
          setMuted(false);
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, (playing) =>
        setAudioBlocked(!playing),
      )
      .on(RoomEvent.MediaDevicesError, (error, kind) =>
        setMessage(describeDeviceError(error, kind)),
      )
      .on(RoomEvent.LocalAudioSilenceDetected, () =>
        setMessage(
          "O microfone está ativo, mas não detectamos áudio. Confira o dispositivo escolhido e o nível de entrada do sistema.",
        ),
      )
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
    try {
      await next.startAudio();
      setAudioBlocked(!next.canPlaybackAudio);
    } catch {
      setAudioBlocked(true);
    }
    await next.setE2EEEnabled(true);
    await publishLocalMedia(next.localParticipant, media);
    setMuted(!media.withMic);
    setCameraOn(media.withCamera);
    setActiveMicrophoneId(media.microphoneId);
    setActiveCameraId(media.cameraId);
    resetScreenShare();
    syncParticipants();
  }

  async function join(transfer: boolean) {
    setPhase("joining");
    setMessage("");
    try {
      if (!encryptionReady || e2ee === null)
        throw new Error("e2ee_unavailable");
      const device = await e2ee.openCall(callId);
      if (device === null) throw new Error("unlock_required");
      const ticket = await joinCall(client, callId, device.deviceId, transfer);
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
    room.current?.disconnect();
    room.current = null;
    keyProvider.current = null;
    mediaKey.current = null;
    await (
      everyone ? endCall(client, callId) : leaveCall(client, callId)
    ).catch(() => undefined);
    onClose();
  }

  async function resumeAudio() {
    const current = room.current;
    if (current === null) return;
    setMessage("");
    try {
      await current.startAudio();
      setAudioBlocked(!current.canPlaybackAudio);
    } catch {
      setAudioBlocked(true);
      setMessage(
        "O navegador ainda bloqueou o áudio da chamada. Verifique a permissão de som do site e tente novamente.",
      );
    }
  }

  async function toggleMicrophone() {
    const current = room.current;
    if (current === null) return;
    const enabled = muted;
    setMessage("");
    try {
      const publication = await current.localParticipant.setMicrophoneEnabled(
        enabled,
        microphoneOptions(microphoneId),
      );
      if (enabled && publication === undefined)
        throw new Error("microphone publication failed");
      const active = current.localParticipant.getTrackPublication(
        Track.Source.Microphone,
      );
      setMuted(active === undefined || active.isMuted);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? describeDeviceError(error, "audioinput")
          : "Não foi possível alterar o microfone.",
      );
    }
  }

  async function toggleCamera() {
    const current = room.current;
    if (current === null) return;
    const enabled = !cameraOn;
    setMessage("");
    try {
      await current.localParticipant.setCameraEnabled(enabled);
      setCameraOn(enabled);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? describeDeviceError(error, "videoinput")
          : "Não foi possível alterar a câmera.",
      );
    }
  }

  async function switchMicrophone(deviceId: string) {
    const current = room.current;
    if (current === null) return;
    setDeviceBusy(true);
    setMessage("");
    try {
      if (!muted) await switchActiveMedia(current, "audioinput", deviceId);
      setActiveMicrophoneId(deviceId);
      rememberMicrophone(deviceId);
    } catch {
      setMessage(
        "Não foi possível trocar o microfone. Verifique se ele está conectado e permitido no navegador.",
      );
    } finally {
      setDeviceBusy(false);
    }
  }

  async function switchCamera(deviceId: string) {
    const current = room.current;
    if (current === null) return;
    setDeviceBusy(true);
    setMessage("");
    try {
      if (cameraOn) await switchActiveMedia(current, "videoinput", deviceId);
      setActiveCameraId(deviceId);
      rememberCamera(deviceId);
    } catch {
      setMessage(
        "Não foi possível trocar a câmera. Verifique se ela está conectada e permitida no navegador.",
      );
    } finally {
      setDeviceBusy(false);
    }
  }

  return {
    participants,
    muted,
    cameraOn,
    audioBlocked,
    microphoneId,
    cameraId,
    deviceBusy,
    needsTransfer,
    since,
    join,
    leave,
    toggleMicrophone,
    toggleCamera,
    resumeAudio,
    switchMicrophone,
    switchCamera,
  };
}
