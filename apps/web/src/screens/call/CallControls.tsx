import type { Call } from "@crewstead/api-client";
import { confirmDialog } from "../../design/confirm";
import { Icon } from "../../design/icons";
import { Menu, useMenu } from "../../design/Menu";
import { DeviceSelect } from "./DeviceSelect";

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
  canEnd,
  microphones,
  cameras,
  microphoneId,
  cameraId,
  deviceBusy,
  onToggleMicrophone,
  onToggleCamera,
  onMicrophoneChange,
  onCameraChange,
  onToggleScreen,
  onSwitchScreen,
  onLeave,
}: {
  muted: boolean;
  cameraOn: boolean;
  sharing: boolean;
  canEnd: Call["canEnd"] | undefined;
  microphones: readonly MediaDeviceInfo[];
  cameras: readonly MediaDeviceInfo[];
  microphoneId: string;
  cameraId: string;
  deviceBusy: boolean;
  onToggleMicrophone: () => void;
  onToggleCamera: () => void;
  onMicrophoneChange: (deviceId: string) => void;
  onCameraChange: (deviceId: string) => void;
  onToggleScreen: () => void;
  onSwitchScreen: () => void;
  onLeave: (everyone: boolean) => void;
}) {
  const devices = useMenu();
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
        aria-expanded={devices.state !== null}
        aria-haspopup="menu"
        aria-label="Escolher microfone e câmera"
        className="cbtn"
        onClick={(event) => devices.toggle(event.currentTarget, undefined)}
        type="button"
      >
        <Icon name="gear" />
      </button>
      {devices.state === null ? null : (
        <Menu
          anchor={devices.state.anchor}
          className="call-device-menu"
          focusFirst={false}
          label="Dispositivos da chamada"
          onClose={devices.close}
          right
          up
        >
          <DeviceSelect
            devices={microphones}
            disabled={deviceBusy}
            fallback="Microfone"
            id="call-microphone"
            label="Microfone da chamada"
            onChange={onMicrophoneChange}
            value={microphoneId}
          />
          <DeviceSelect
            devices={cameras}
            disabled={deviceBusy}
            fallback="Câmera"
            id="call-camera"
            label="Câmera da chamada"
            onChange={onCameraChange}
            value={cameraId}
          />
          <p aria-live="polite" className="xs muted call-device-status">
            {deviceBusy
              ? "Trocando dispositivo…"
              : "A alteração vale imediatamente para esta chamada."}
          </p>
        </Menu>
      )}
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
      ) : null}
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
