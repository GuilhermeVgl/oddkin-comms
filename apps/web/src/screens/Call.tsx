import {
  ApiStatusError,
  CallConflictError,
  createApiClient,
  endCall,
  getCall,
  joinCall,
  leaveCall,
  readCookie,
  startScreenShare,
  stopScreenShare,
  type Call,
  type CallTicket,
} from "@crewstead/api-client";
import {
  ExternalE2EEKeyProvider,
  Room,
  RoomEvent,
  Track,
  type Participant,
} from "livekit-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { confirmDialog } from "../design/confirm";
import { Icon, Logo } from "../design/icons";
import { nameOf } from "../design/people";
import { Banner } from "../design/primitives";
import { blip } from "../design/sound";
import { Sprite } from "../design/Sprite";
import { useOptionalE2EE } from "../e2ee/E2EE";
import { useEvents } from "../events";
import { useInbox } from "../inbox";
import { useWorkspace } from "../workspace";

type Client = ReturnType<typeof createApiClient>;

function csrf(): string | null {
  return readCookie(document.cookie, "crewstead_csrf");
}

const CONFLICT_MESSAGE: Record<string, string> = {
  call_full: "Esta chamada já tem 5 participantes.",
  in_other_call: "Você já está em outra chamada. Saia dela antes de entrar.",
  other_device: "Você já está nesta chamada em outro dispositivo.",
  call_ended: "Esta chamada já terminou.",
  screen_share_taken: "Outra pessoa já está compartilhando a tela.",
  not_in_call: "Entre na chamada antes de compartilhar a tela.",
};

function describe(error: unknown): string {
  if (error instanceof CallConflictError && error.code !== null) {
    return CONFLICT_MESSAGE[error.code] ?? "Não foi possível concluir.";
  }
  if (error instanceof ApiStatusError) {
    if (error.status === 403) return "Seu perfil não permite esta ação.";
    if (error.status === 503)
      return "O servidor de chamadas não está disponível.";
  }
  return "Não foi possível concluir a ação.";
}

function supportsMediaE2EE(): boolean {
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

function e2eeWorker(): Worker {
  return new Worker(new URL("livekit-client/e2ee-worker", import.meta.url), {
    type: "module",
  });
}

function keyBuffer(key: Uint8Array): ArrayBuffer {
  return Uint8Array.from(key).buffer;
}

/** A level meter for the microphone preview, drawn from the real audio. */
function useMicLevels(stream: MediaStream | null, bars: number): number[] {
  const [levels, setLevels] = useState<number[]>(() =>
    Array.from({ length: bars }, () => 0.1),
  );
  useEffect(() => {
    if (stream === null || stream.getAudioTracks().length === 0) {
      setLevels(Array.from({ length: bars }, () => 0.1));
      return undefined;
    }
    let frame = 0;
    let context: AudioContext | null = null;
    try {
      context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 64;
      context.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteFrequencyData(data);
        setLevels(
          Array.from({ length: bars }, (_, index) => {
            const value =
              (data[Math.min(data.length - 1, index + 1)] ?? 0) / 255;
            return Math.max(0.1, Math.min(1, value * 1.4));
          }),
        );
        frame = requestAnimationFrame(loop);
      };
      loop();
    } catch {
      // Without Web Audio the meter just stays low.
    }
    return () => {
      cancelAnimationFrame(frame);
      void context?.close();
    };
  }, [stream, bars]);
  return levels;
}

function Tile({
  participant,
  shared,
  external,
}: {
  participant: Participant;
  shared: boolean;
  external: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [speaking, setSpeaking] = useState(participant.isSpeaking);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const refresh = () => setVersion((value) => value + 1);
    const events = [
      "trackPublished",
      "trackSubscribed",
      "trackUnsubscribed",
      "trackMuted",
      "trackUnmuted",
      "localTrackPublished",
      "localTrackUnpublished",
    ] as const;
    participant.on("isSpeakingChanged", setSpeaking);
    for (const name of events) participant.on(name, refresh);
    return () => {
      participant.off("isSpeakingChanged", setSpeaking);
      for (const name of events) participant.off(name, refresh);
    };
  }, [participant]);

  useEffect(() => {
    const element = video.current;
    const screen = participant.getTrackPublication(
      Track.Source.ScreenShare,
    )?.track;
    const camera = participant.getTrackPublication(Track.Source.Camera)?.track;
    const track = shared ? (screen ?? camera) : (camera ?? screen);
    if (element === null || track === undefined) return undefined;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [participant, version, shared]);

  const microphone = participant.getTrackPublication(Track.Source.Microphone);
  const muted = microphone === undefined || microphone.isMuted;
  const hasVideo =
    participant.getTrackPublication(Track.Source.Camera)?.track !== undefined ||
    participant.getTrackPublication(Track.Source.ScreenShare)?.track !==
      undefined;
  const name = participant.name ?? participant.identity;
  const lit = speaking && !muted;
  return (
    <div
      aria-label={`${nameOf(name)}${muted ? ", microfone desligado" : ""}${lit ? ", falando" : ""}`}
      className={`tile${lit ? " speaking" : ""}${shared ? " shared" : ""}`}
    >
      <video
        autoPlay
        muted={participant.isLocal}
        playsInline
        ref={video}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: shared ? "contain" : "cover",
          display: hasVideo ? "block" : "none",
        }}
      />
      {hasVideo ? null : (
        <span
          className="av xl"
          data-c={(name.length % 6) + 1}
          style={{ position: "relative" }}
        >
          {nameOf(name).charAt(0)}
        </span>
      )}
      <div className="nm">
        {lit ? (
          <span aria-hidden="true" className="eqz">
            <i />
            <i />
            <i />
          </span>
        ) : null}
        {nameOf(name)}
        {shared ? " · tela" : ""}
        {external ? <span className="ext">externo</span> : null}
        {participant.isLocal ? " (você)" : ""}
      </div>
      {muted ? (
        <span aria-label="Microfone desligado" className="tag mute" role="img">
          <Icon name="micOff" size="sm" />
        </span>
      ) : null}
    </div>
  );
}

type Phase = "preview" | "joining" | "connected" | "error";

function Clock({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <span className="mono xs" style={{ color: "#b5bcaf" }}>
      {String(Math.floor(seconds / 60)).padStart(2, "0")}:
      {String(seconds % 60).padStart(2, "0")}
    </span>
  );
}

/** LiveKit's numeric TrackSource for a shared screen (livekit.TrackSource.SCREEN_SHARE). */
const SCREEN_SHARE_SOURCE = 3;

/**
 * The server grants the screen with a permission update that reaches the
 * browser a moment after its answer; publishing before it arrives is refused.
 */
function waitForScreenPermission(room: Room, timeoutMs = 6000): Promise<void> {
  const allowed = () => {
    const sources = room.localParticipant.permissions?.canPublishSources ?? [];
    // An empty list means "every source".
    return (
      sources.length === 0 ||
      sources.some((source) => Number(source) === SCREEN_SHARE_SOURCE)
    );
  };
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

/** Browsers say "denied" when the person cancels the picker; that is not an error to show. */
function describeShare(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError")
    return "";
  if (error instanceof Error && error.message === "screen_permission_timeout")
    return "Não foi possível liberar o compartilhamento agora. Tente de novo.";
  return describe(error);
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
  const [phase, setPhase] = useState<Phase>("preview");
  const [call, setCall] = useState<Call | null>(null);
  const [withCamera, setWithCamera] = useState(true);
  const [withMic, setWithMic] = useState(true);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [microphoneId, setMicrophoneId] = useState("");
  const [cameraId, setCameraId] = useState("");
  const [message, setMessage] = useState("");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [needsTransfer, setNeedsTransfer] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [since, setSince] = useState(0);
  const room = useRef<Room | null>(null);
  const mediaKey = useRef<Uint8Array | null>(null);
  const keyProvider = useRef<ExternalE2EEKeyProvider | null>(null);
  const preview = useRef<HTMLVideoElement>(null);
  const supported = supportsMediaE2EE();
  const unlocked = e2ee?.phase === "unlocked";
  const encryptionReady = unlocked && supported;
  const levels = useMicLevels(withMic ? stream : null, 12);

  const title = useMemo(() => {
    if (call === null) return "Chamada";
    const channel = channels.find((entry) => entry.id === call.conversationId);
    if (channel !== undefined) return `#${channel.name}`;
    const direct = dms.find((entry) => entry.id === call.conversationId);
    return direct === undefined ? "Conversa direta" : nameOf(direct.peerEmail);
  }, [call, channels, dms]);

  useEffect(() => {
    getCall(client, callId)
      .then(setCall)
      .catch(() => setMessage("Chamada indisponível."));
  }, [client, callId]);

  useEvents((event) => {
    if (
      event !== "resync" &&
      event.eventType === "call.changed" &&
      event.resourceId === callId
    ) {
      getCall(client, callId)
        .then(setCall)
        .catch(() => undefined);
    }
  });

  // Camera and microphone preview with device selection, before joining.
  useEffect(() => {
    if (phase !== "preview") return undefined;
    let opened: MediaStream | null = null;
    let active = true;
    navigator.mediaDevices
      .getUserMedia({
        audio: microphoneId === "" ? true : { deviceId: microphoneId },
        video: withCamera
          ? cameraId === ""
            ? true
            : { deviceId: cameraId }
          : false,
      })
      .then(async (value) => {
        if (!active) {
          value.getTracks().forEach((track) => track.stop());
          return;
        }
        opened = value;
        setStream(value);
        if (preview.current !== null) preview.current.srcObject = value;
        setDevices(await navigator.mediaDevices.enumerateDevices());
      })
      .catch(() =>
        setMessage(
          "Não foi possível acessar câmera ou microfone. Você pode entrar sem câmera.",
        ),
      );
    return () => {
      active = false;
      opened?.getTracks().forEach((track) => track.stop());
      setStream(null);
    };
  }, [phase, withCamera, microphoneId, cameraId]);

  const syncParticipants = useCallback(() => {
    const current = room.current;
    if (current === null) return;
    setParticipants([
      current.localParticipant,
      ...current.remoteParticipants.values(),
    ]);
  }, []);

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

  async function connect(ticket: CallTicket, publishScreen: boolean) {
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
      .on(RoomEvent.LocalTrackUnpublished, (publication) => {
        // "Stop sharing" in the browser's own bar: give the slot back.
        if (publication.source !== Track.Source.ScreenShare) return;
        setSharing(false);
        const token = csrf();
        if (token !== null)
          void stopScreenShare(client, token, callId).catch(() => undefined);
      })
      .on(RoomEvent.Disconnected, () =>
        setPhase((value) => (value === "connected" ? "error" : value)),
      );
    await next.connect(ticket.url, ticket.token);
    await next.setE2EEEnabled(true);
    await next.localParticipant.setMicrophoneEnabled(
      withMic,
      microphoneId === "" ? undefined : { deviceId: microphoneId },
    );
    if (withCamera) {
      await next.localParticipant.setCameraEnabled(
        true,
        cameraId === ""
          ? { resolution: { width: 1280, height: 720, frameRate: 30 } }
          : {
              deviceId: cameraId,
              resolution: { width: 1280, height: 720, frameRate: 30 },
            },
      );
    }
    if (publishScreen) {
      await next.localParticipant.setScreenShareEnabled(true, {
        resolution: { width: 1920, height: 1080, frameRate: 15 },
      });
    }
    setMuted(!withMic);
    setCameraOn(withCamera);
    setSharing(publishScreen);
    syncParticipants();
  }

  async function join(transfer: boolean) {
    const token = csrf();
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
      await connect(ticket, false);
      setSince(Date.now());
      setPhase("connected");
      blip("ok");
    } catch (error) {
      room.current?.disconnect();
      room.current = null;
      setNeedsTransfer(
        error instanceof CallConflictError && error.code === "other_device",
      );
      if (error instanceof Error && error.message === "unlock_required") {
        setMessage("Libere a criptografia deste navegador antes de entrar.");
      } else if (
        error instanceof Error &&
        error.message === "e2ee_unavailable"
      ) {
        setMessage(
          "Este navegador não suporta criptografia de mídia obrigatória.",
        );
      } else {
        setMessage(describe(error));
      }
      blip("err");
      setPhase("preview");
    }
  }

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

  async function toggleScreen() {
    const token = csrf();
    const active = room.current;
    if (token === null || active === null) return;
    try {
      if (sharing) {
        await active.localParticipant.setScreenShareEnabled(false);
        await stopScreenShare(client, token, callId);
        setSharing(false);
        return;
      }
      // The server arbitrates the single slot and then lets LiveKit accept the
      // screen from this person, so they stay in the room: reconnecting would
      // make the server see them leave.
      await startScreenShare(client, token, callId);
      try {
        await waitForScreenPermission(active);
        await active.localParticipant.setScreenShareEnabled(true, {
          resolution: { width: 1920, height: 1080, frameRate: 15 },
        });
      } catch (error) {
        // The picker was cancelled or the browser refused: free the slot again.
        await stopScreenShare(client, token, callId).catch(() => undefined);
        throw error;
      }
      setSharing(true);
      setMessage("");
      blip("ok");
    } catch (error) {
      setSharing(false);
      setMessage(describeShare(error));
    }
  }

  async function leave(everyone: boolean) {
    const token = csrf();
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

  useEffect(
    () => () => {
      room.current?.disconnect();
      keyProvider.current = null;
      mediaKey.current = null;
    },
    [],
  );

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        phase === "preview" &&
        document.querySelector(".menu, dialog[open]") === null
      )
        onClose();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [phase, onClose]);

  const microphones = useMemo(
    () => devices.filter((d) => d.kind === "audioinput"),
    [devices],
  );
  const cameras = useMemo(
    () => devices.filter((d) => d.kind === "videoinput"),
    [devices],
  );
  const count = participants.length;
  const sharer = participants.find(
    (participant) =>
      participant.getTrackPublication(Track.Source.ScreenShare)?.track !==
      undefined,
  );
  const ordered =
    sharer === undefined
      ? participants
      : [
          sharer,
          ...participants.filter((participant) => participant !== sharer),
        ];
  const rotating = call !== null && call.keyState !== "ok";
  const externalOf = (identity: string) => {
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
        <>
          <div className="sh">
            <span
              className="brand"
              style={{ padding: 0, color: "var(--papel)" }}
            >
              <Logo />
            </span>
            <h2 className="grow">Entrar em {title}</h2>
            <button
              aria-label="Cancelar"
              className="iconbtn"
              onClick={onClose}
              style={{ color: "var(--papel)" }}
              type="button"
            >
              <Icon name="x" />
            </button>
          </div>
          <div className="prejoin">
            <div>
              <div aria-label="Prévia da câmera" className="cam-prev">
                {withCamera ? <div className="cam" /> : null}
                <video
                  autoPlay
                  muted
                  playsInline
                  ref={preview}
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: withCamera && stream !== null ? "block" : "none",
                  }}
                />
                {withCamera && stream !== null ? null : (
                  <div style={{ position: "relative" }}>
                    <Sprite
                      pose={withCamera ? "idle" : "sleep"}
                      scale={6}
                      who="capuz"
                    />
                  </div>
                )}
                {withCamera ? null : (
                  <span
                    className="pixel"
                    style={{ position: "absolute", bottom: 14, fontSize: 18 }}
                  >
                    Câmera desligada
                  </span>
                )}
              </div>
              <div
                className="row"
                style={{ justifyContent: "center", marginTop: 14 }}
              >
                <button
                  aria-label={
                    withMic ? "Silenciar microfone" : "Ativar microfone"
                  }
                  aria-pressed={withMic}
                  className={`cbtn${withMic ? "" : " off"}`}
                  onClick={() => setWithMic((value) => !value)}
                  type="button"
                >
                  <Icon name={withMic ? "mic" : "micOff"} />
                </button>
                <button
                  aria-label={withCamera ? "Desligar câmera" : "Ligar câmera"}
                  aria-pressed={withCamera}
                  className={`cbtn${withCamera ? "" : " off"}`}
                  onClick={() => setWithCamera((value) => !value)}
                  type="button"
                >
                  <Icon name={withCamera ? "video" : "videoOff"} />
                </button>
                <div aria-hidden="true" className="mic-meter">
                  {levels.map((level, index) => (
                    <i
                      key={index}
                      style={{ transform: `scaleY(${withMic ? level : 0.1})` }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="col gap16">
              <div>
                <h1
                  style={{
                    fontSize: 28,
                    fontWeight: 760,
                    letterSpacing: "-.02em",
                  }}
                >
                  Pronto para entrar?
                </h1>
                <p style={{ color: "#b5bcaf", marginTop: 6 }}>
                  {call === null
                    ? "Carregando a chamada…"
                    : `${call.participants.length}/${call.maxParticipants} participantes agora. Até ${call.maxParticipants} pessoas.`}
                </p>
              </div>
              <div className="field">
                <label htmlFor="dmic">Microfone</label>
                <select
                  className="inp"
                  id="dmic"
                  onChange={(event) => setMicrophoneId(event.target.value)}
                  value={microphoneId}
                >
                  <option value="">Padrão</option>
                  {microphones.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || "Microfone"}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="dcam">Câmera</label>
                <select
                  className="inp"
                  disabled={!withCamera}
                  id="dcam"
                  onChange={(event) => setCameraId(event.target.value)}
                  value={cameraId}
                >
                  <option value="">Padrão</option>
                  {cameras.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || "Câmera"}
                    </option>
                  ))}
                </select>
              </div>
              {!supported ? (
                <Banner kind="err" role="alert">
                  <b>
                    Este navegador não suporta criptografia de ponta a ponta de
                    mídia.
                  </b>{" "}
                  Para sua segurança, a chamada não segue sem E2EE e não há modo
                  sem criptografia. Use Chrome ou Edge atuais no desktop.
                </Banner>
              ) : !unlocked ? (
                <Banner kind="warn" role="alert">
                  Libere a criptografia deste navegador para participar. A chave
                  da chamada é entregue só a dispositivos liberados.
                </Banner>
              ) : (
                <Banner icon="shieldOk" kind="ok">
                  Navegador compatível. Áudio, câmera e tela saem cifrados com
                  uma chave efêmera de chamada.
                </Banner>
              )}
              {window.innerWidth < 900 ? (
                <Banner icon="info" kind="warn">
                  Chamadas funcionam melhor no desktop.
                </Banner>
              ) : null}
              {message === "" ? null : (
                <Banner kind="err" role="alert">
                  {message}
                </Banner>
              )}
              <div className="row">
                <button
                  className={`btn primary lg grow${phase === "joining" ? " loading" : ""}`}
                  disabled={phase === "joining" || !encryptionReady}
                  onClick={() => void join(false)}
                  type="button"
                >
                  <Icon name="phone" /> Entrar na chamada
                </button>
                {needsTransfer ? (
                  <button
                    className="btn ghost"
                    onClick={() => void join(true)}
                    style={{ color: "var(--papel)" }}
                    type="button"
                  >
                    Transferir para este dispositivo
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </>
      ) : null}
      {phase === "connected" ? (
        <>
          <div className="sh">
            <h2>{title}</h2>
            <span
              className="lock"
              title="Chave de mídia efêmera, distribuída em envelopes para os dispositivos admitidos"
            >
              <Icon name="lock" size="sm" />
              E2EE · chave v{call?.keyGeneration ?? 1}
            </span>
            <span className="grow" />
            <span
              className="tag mute num"
              style={{ background: "#1d221e", color: "#d3d8cf" }}
            >
              {count} de {call?.maxParticipants ?? 5} participantes
            </span>
            <Clock since={since} />
          </div>
          {rotating ? (
            <div className="keyrot toast" role="status">
              <Icon name="rot" />
              <span>
                {call?.keyState === "rotation_required"
                  ? "Rotacionando chave de mídia"
                  : "Aguardando a chave"}
                … publicação bloqueada até confirmar a chave v
                {call?.keyGeneration ?? 1}
              </span>
            </div>
          ) : null}
          <div
            aria-live="polite"
            className={`tiles${sharer === undefined ? "" : " share"}`}
            data-n={Math.min(count, 5)}
          >
            {ordered.map((participant) => (
              <Tile
                external={externalOf(participant.identity)}
                key={participant.identity}
                participant={participant}
                shared={participant === sharer}
              />
            ))}
          </div>
          <div
            aria-label="Controles da chamada"
            className="ctrl"
            role="toolbar"
          >
            <button
              aria-label={muted ? "Ativar microfone" : "Silenciar"}
              aria-pressed={!muted}
              className={`cbtn${muted ? " off" : ""}`}
              onClick={() => {
                const next = !muted;
                void room.current?.localParticipant
                  .setMicrophoneEnabled(!next)
                  .then(() => setMuted(next));
              }}
              type="button"
            >
              <Icon name={muted ? "micOff" : "mic"} />
            </button>
            <button
              aria-label={cameraOn ? "Desligar câmera" : "Ligar câmera"}
              aria-pressed={cameraOn}
              className={`cbtn${cameraOn ? "" : " off"}`}
              onClick={() => {
                const next = !cameraOn;
                void room.current?.localParticipant
                  .setCameraEnabled(next)
                  .then(() => setCameraOn(next));
              }}
              type="button"
            >
              <Icon name={cameraOn ? "video" : "videoOff"} />
            </button>
            <button
              aria-label={
                sharing ? "Parar de compartilhar" : "Compartilhar tela"
              }
              aria-pressed={sharing}
              className="cbtn"
              onClick={() => void toggleScreen()}
              type="button"
            >
              <Icon name="screen" />
            </button>
            <button
              className="cbtn end"
              onClick={() => void leave(false)}
              type="button"
            >
              <Icon name="phone" size="sm" />
              Sair
            </button>
            {call?.canEnd ? (
              <button
                className="cbtn end"
                onClick={() => {
                  void confirmDialog({
                    title: "Encerrar para todos?",
                    body: (
                      <p className="muted">
                        A chamada termina para as outras pessoas e a chave
                        efêmera é descartada. Nada foi gravado.
                      </p>
                    ),
                    ok: "Encerrar",
                    danger: true,
                  }).then((ok) => ok === true && void leave(true));
                }}
                style={{
                  background: "#3a1f19",
                  borderColor: "#5a2f25",
                  color: "#ffb8a6",
                }}
                type="button"
              >
                Encerrar para todos
              </button>
            ) : null}
          </div>
          {message === "" ? null : (
            <Banner kind="err" role="alert" style={{ margin: "0 20px 16px" }}>
              {message}
            </Banner>
          )}
        </>
      ) : null}
      {phase === "error" ? (
        <div className="prejoin" style={{ gridTemplateColumns: "1fr" }}>
          <div
            className="col gap16"
            style={{ alignItems: "center", textAlign: "center" }}
          >
            <Sprite pose="oops" scale={6} who="tela" />
            <h1 style={{ fontSize: 28, fontWeight: 760 }}>
              A conexão com a chamada foi perdida
            </h1>
            {message === "" ? null : (
              <p style={{ color: "#b5bcaf" }}>{message}</p>
            )}
            <div className="row">
              <button
                className="btn primary lg"
                onClick={() => setPhase("preview")}
                type="button"
              >
                Tentar entrar de novo
              </button>
              <button
                className="btn ghost"
                onClick={onClose}
                style={{ color: "var(--papel)" }}
                type="button"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );

  return createPortal(stage, document.body);
}
