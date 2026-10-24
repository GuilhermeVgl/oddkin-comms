import {
  ApiStatusError,
  CallConflictError,
  createApiClient,
  declineCall,
  endCall,
  getCall,
  joinCall,
  leaveCall,
  listActiveCalls,
  listCallInvitations,
  readCookie,
  startCall,
  startScreenShare,
  stopScreenShare,
  type Call,
  type CallInvitation,
  type CallTicket,
  type ProjectMember,
} from "@oddkin/api-client";
import { Room, RoomEvent, Track, type Participant } from "livekit-client";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useEvents } from "./events";

type Client = ReturnType<typeof createApiClient>;

function csrf(): string | null {
  return readCookie(document.cookie, "oddkin_csrf");
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

/** Start/join controls shown inside a conversation. */
export function CallBar({
  client,
  conversationId,
  me,
  members,
  isDirect,
}: {
  client: Client;
  conversationId: string;
  me: string;
  members: ProjectMember[];
  isDirect: boolean;
}) {
  const [call, setCall] = useState<Call | null>(null);
  const [openCall, setOpenCall] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const reload = useCallback(async () => {
    try {
      setCall((await listActiveCalls(client, conversationId))[0] ?? null);
    } catch {
      setCall(null);
    }
  }, [client, conversationId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEvents((event) => {
    if (
      event === "resync" ||
      (event.contextId === conversationId && event.eventType === "call.changed")
    ) {
      void reload();
    }
  });

  async function start() {
    const token = csrf();
    if (token === null) return;
    const invitees = members
      .filter((member) => member.email !== me)
      .map((member) => member.accountId);
    try {
      const created = await startCall(
        client,
        token,
        conversationId,
        isDirect ? [] : invitees,
      );
      setCall(created);
      setOpenCall(created.id);
      setMessage("");
    } catch (error) {
      setMessage(describe(error));
    }
  }

  return (
    <div className="call-bar">
      {call === null ? (
        <button onClick={() => void start()} type="button">
          Iniciar chamada
        </button>
      ) : (
        <>
          <span>
            Chamada em andamento ({call.participants.length}/
            {call.maxParticipants})
          </span>{" "}
          <button onClick={() => setOpenCall(call.id)} type="button">
            Entrar
          </button>
        </>
      )}
      <p aria-live="polite" className="form-message">
        {message}
      </p>
      {openCall !== null ? (
        <CallRoom
          callId={openCall}
          client={client}
          onClose={() => {
            setOpenCall(null);
            void reload();
          }}
        />
      ) : null}
    </div>
  );
}

/** Pending invitations, shown wherever the person is in the app. */
export function CallInvitations({ client }: { client: Client }) {
  const [invitations, setInvitations] = useState<CallInvitation[]>([]);
  const [openCall, setOpenCall] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setInvitations(await listCallInvitations(client));
    } catch {
      // The next event reloads.
    }
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEvents((event) => {
    if (
      event === "resync" ||
      event.eventType === "call.invited" ||
      event.eventType === "call.changed"
    ) {
      void reload();
    }
  });

  async function decline(id: string) {
    const token = csrf();
    if (token === null) return;
    await declineCall(client, token, id).catch(() => undefined);
    await reload();
  }

  return (
    <>
      {invitations.length > 0 ? (
        <div className="call-invite" role="alert">
          {invitations.map((invitation) => (
            <p key={invitation.callId}>
              {invitation.startedBy || "Alguém"} está chamando você.{" "}
              <button
                onClick={() => setOpenCall(invitation.callId)}
                type="button"
              >
                Atender
              </button>{" "}
              <button
                className="text-button"
                onClick={() => void decline(invitation.callId)}
                type="button"
              >
                Recusar
              </button>
            </p>
          ))}
        </div>
      ) : null}
      {openCall !== null ? (
        <CallRoom
          callId={openCall}
          client={client}
          onClose={() => {
            setOpenCall(null);
            void reload();
          }}
        />
      ) : null}
    </>
  );
}

function VideoTile({ participant }: { participant: Participant }) {
  const video = useRef<HTMLVideoElement>(null);
  const [speaking, setSpeaking] = useState(participant.isSpeaking);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const refresh = () => setVersion((value) => value + 1);
    participant.on("isSpeakingChanged", setSpeaking);
    participant.on("trackPublished", refresh);
    participant.on("trackSubscribed", refresh);
    participant.on("trackUnsubscribed", refresh);
    participant.on("trackMuted", refresh);
    participant.on("trackUnmuted", refresh);
    participant.on("localTrackPublished", refresh);
    participant.on("localTrackUnpublished", refresh);
    return () => {
      participant.off("isSpeakingChanged", setSpeaking);
      participant.off("trackPublished", refresh);
      participant.off("trackSubscribed", refresh);
      participant.off("trackUnsubscribed", refresh);
      participant.off("trackMuted", refresh);
      participant.off("trackUnmuted", refresh);
      participant.off("localTrackPublished", refresh);
      participant.off("localTrackUnpublished", refresh);
    };
  }, [participant]);

  useEffect(() => {
    const element = video.current;
    const screen = participant.getTrackPublication(
      Track.Source.ScreenShare,
    )?.track;
    const camera = participant.getTrackPublication(Track.Source.Camera)?.track;
    const track = screen ?? camera;
    if (element === null || track === undefined) return undefined;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [participant, version]);

  const audio = participant.getTrackPublication(Track.Source.Microphone);
  const hasVideo =
    participant.getTrackPublication(Track.Source.Camera)?.track !== undefined ||
    participant.getTrackPublication(Track.Source.ScreenShare)?.track !==
      undefined;
  return (
    <li className={speaking ? "tile tile--speaking" : "tile"}>
      <video
        autoPlay
        hidden={!hasVideo}
        muted={participant.isLocal}
        playsInline
        ref={video}
      />
      <span>
        {participant.name ?? participant.identity}
        {audio?.isMuted ? " · mudo" : ""}
        {speaking ? " · falando" : ""}
      </span>
    </li>
  );
}

type Phase = "preview" | "joining" | "connected" | "error";

export function CallRoom({
  client,
  callId,
  onClose,
}: {
  client: Client;
  callId: string;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("preview");
  const [call, setCall] = useState<Call | null>(null);
  const [withCamera, setWithCamera] = useState(true);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [microphoneId, setMicrophoneId] = useState("");
  const [cameraId, setCameraId] = useState("");
  const [message, setMessage] = useState("");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [needsTransfer, setNeedsTransfer] = useState(false);
  const room = useRef<Room | null>(null);
  const preview = useRef<HTMLVideoElement>(null);

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
    let stream: MediaStream | null = null;
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
      .then(async (opened) => {
        if (!active) {
          opened.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = opened;
        if (preview.current !== null) preview.current.srcObject = opened;
        setDevices(await navigator.mediaDevices.enumerateDevices());
      })
      .catch(() =>
        setMessage(
          "Não foi possível acessar câmera ou microfone. Você pode entrar sem câmera.",
        ),
      );
    return () => {
      active = false;
      stream?.getTracks().forEach((track) => track.stop());
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

  async function connect(ticket: CallTicket, publishScreen: boolean) {
    const next = new Room({ adaptiveStream: true, dynacast: true });
    room.current = next;
    next
      .on(RoomEvent.ParticipantConnected, syncParticipants)
      .on(RoomEvent.ParticipantDisconnected, syncParticipants)
      .on(RoomEvent.TrackSubscribed, syncParticipants)
      .on(RoomEvent.Disconnected, () =>
        setPhase((value) => (value === "connected" ? "error" : value)),
      );
    await next.connect(ticket.url, ticket.token);
    await next.localParticipant.setMicrophoneEnabled(
      true,
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
    setMuted(false);
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
      const ticket = await joinCall(client, token, callId, transfer);
      await connect(ticket, false);
      setPhase("connected");
    } catch (error) {
      room.current?.disconnect();
      room.current = null;
      setNeedsTransfer(
        error instanceof CallConflictError && error.code === "other_device",
      );
      setMessage(describe(error));
      setPhase("preview");
    }
  }

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
      // The slot is arbitrated by the server; the token that allows the
      // source is only issued to the current presenter, so reconnect with it.
      const ticket = await startScreenShare(client, token, callId);
      active.disconnect();
      await connect(ticket, true);
      setMessage("");
    } catch (error) {
      setMessage(describe(error));
    }
  }

  async function leave(everyone: boolean) {
    const token = csrf();
    room.current?.disconnect();
    room.current = null;
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
    },
    [],
  );

  const microphones = useMemo(
    () => devices.filter((d) => d.kind === "audioinput"),
    [devices],
  );
  const cameras = useMemo(
    () => devices.filter((d) => d.kind === "videoinput"),
    [devices],
  );

  return (
    <div
      aria-label="Chamada"
      aria-modal="true"
      className="call-room"
      role="dialog"
    >
      <p className="call-room__notice">
        Esta versão da chamada ainda não usa criptografia de ponta a ponta.
      </p>
      {call !== null ? (
        <p>
          {call.participants.length}/{call.maxParticipants} participantes
        </p>
      ) : null}
      {phase === "preview" || phase === "joining" ? (
        <div>
          <video
            aria-label="Prévia da câmera"
            autoPlay
            muted
            playsInline
            ref={preview}
          />
          <label>
            <input
              checked={!withCamera}
              onChange={(event) => setWithCamera(!event.target.checked)}
              type="checkbox"
            />
            Entrar sem câmera
          </label>
          <label htmlFor="call-mic">Microfone</label>
          <select
            id="call-mic"
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
          {withCamera ? (
            <>
              <label htmlFor="call-camera">Câmera</label>
              <select
                id="call-camera"
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
            </>
          ) : null}
          <div className="inline-form">
            <button
              disabled={phase === "joining"}
              onClick={() => void join(false)}
              type="button"
            >
              {phase === "joining" ? "Entrando…" : "Entrar na chamada"}
            </button>
            {needsTransfer ? (
              <button onClick={() => void join(true)} type="button">
                Transferir para este dispositivo
              </button>
            ) : null}
            <button className="text-button" onClick={onClose} type="button">
              Cancelar
            </button>
          </div>
        </div>
      ) : null}
      {phase === "connected" ? (
        <>
          <ul className="tiles">
            {participants.map((participant) => (
              <VideoTile key={participant.identity} participant={participant} />
            ))}
          </ul>
          <div className="inline-form">
            <button
              aria-pressed={muted}
              onClick={() => {
                const next = !muted;
                void room.current?.localParticipant
                  .setMicrophoneEnabled(!next)
                  .then(() => setMuted(next));
              }}
              type="button"
            >
              {muted ? "Ativar microfone" : "Silenciar"}
            </button>
            <button
              aria-pressed={cameraOn}
              onClick={() => {
                const next = !cameraOn;
                void room.current?.localParticipant
                  .setCameraEnabled(next)
                  .then(() => setCameraOn(next));
              }}
              type="button"
            >
              {cameraOn ? "Desligar câmera" : "Ligar câmera"}
            </button>
            <button onClick={() => void toggleScreen()} type="button">
              {sharing ? "Parar compartilhamento" : "Compartilhar tela"}
            </button>
            <button onClick={() => void leave(false)} type="button">
              Sair
            </button>
            {call?.canEnd ? (
              <button onClick={() => void leave(true)} type="button">
                Encerrar para todos
              </button>
            ) : null}
          </div>
        </>
      ) : null}
      {phase === "error" ? (
        <p>
          A conexão com a chamada foi perdida.{" "}
          <button onClick={() => setPhase("preview")} type="button">
            Tentar entrar de novo
          </button>
        </p>
      ) : null}
      <p aria-live="polite" className="form-message">
        {message}
      </p>
    </div>
  );
}
