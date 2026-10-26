import type { Call } from "@crewstead/api-client";
import { confirmDialog } from "../../design/confirm";
import { Icon } from "../../design/icons";

/** Asks before ending the call for everyone, then calls `onEnd`. */
function confirmEndForAll(onEnd: () => void) {
  void confirmDialog({
    title: "Encerrar para todos?",
    body: (
      <p className="muted">
        A chamada termina para as outras pessoas e a chave efêmera é descartada.
        Nada foi gravado.
      </p>
    ),
    ok: "Encerrar",
    danger: true,
  }).then((ok) => ok === true && onEnd());
}

/** The toolbar under the tiles: microphone, camera, screen share and leaving. */
export function CallControls({
  muted,
  cameraOn,
  sharing,
  shareAudio,
  canEnd,
  onToggleMicrophone,
  onToggleCamera,
  onToggleScreen,
  onSwitchScreen,
  onToggleShareAudio,
  onLeave,
}: {
  muted: boolean;
  cameraOn: boolean;
  sharing: boolean;
  shareAudio: boolean;
  canEnd: Call["canEnd"] | undefined;
  onToggleMicrophone: () => void;
  onToggleCamera: () => void;
  onToggleScreen: () => void;
  onSwitchScreen: () => void;
  onToggleShareAudio: () => void;
  onLeave: (everyone: boolean) => void;
}) {
  return (
    <div aria-label="Controles da chamada" className="ctrl" role="toolbar">
      <button
        aria-label={muted ? "Ativar microfone" : "Silenciar"}
        aria-pressed={!muted}
        className={`cbtn${muted ? " off" : ""}`}
        onClick={onToggleMicrophone}
        type="button"
      >
        <Icon name={muted ? "micOff" : "mic"} />
      </button>
      <button
        aria-label={cameraOn ? "Desligar câmera" : "Ligar câmera"}
        aria-pressed={cameraOn}
        className={`cbtn${cameraOn ? "" : " off"}`}
        onClick={onToggleCamera}
        type="button"
      >
        <Icon name={cameraOn ? "video" : "videoOff"} />
      </button>
      <button
        aria-label={sharing ? "Parar de compartilhar" : "Compartilhar tela"}
        aria-pressed={sharing}
        className="cbtn"
        onClick={onToggleScreen}
        type="button"
      >
        <Icon name="screen" />
      </button>
      {sharing ? (
        <button
          className="cbtn"
          onClick={onSwitchScreen}
          title="Escolher outra tela"
          type="button"
        >
          Trocar tela
        </button>
      ) : (
        <button
          aria-label="Compartilhar com som"
          aria-pressed={shareAudio}
          className={`cbtn${shareAudio ? "" : " off"}`}
          onClick={onToggleShareAudio}
          title="Incluir o som da tela escolhida (depende do navegador)"
          type="button"
        >
          {shareAudio ? "Com som" : "Sem som"}
        </button>
      )}
      <button className="cbtn end" onClick={() => onLeave(false)} type="button">
        <Icon name="phone" size="sm" />
        Sair
      </button>
      {canEnd ? (
        <button
          className="cbtn end everyone"
          onClick={() => confirmEndForAll(() => onLeave(true))}
          type="button"
        >
          Encerrar para todos
        </button>
      ) : null}
    </div>
  );
}
