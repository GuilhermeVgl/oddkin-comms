import type { Call } from "@crewstead/api-client";
import { Icon, Logo } from "../../design/icons";
import { Banner } from "../../design/primitives";
import { Sprite } from "../../design/Sprite";
import { prejoinSubtitle } from "./callView";
import type { Prejoin } from "./usePrejoin";

/** Camera preview with the microphone and camera switches and the level meter. */
function CameraPreview({ prejoin }: { prejoin: Prejoin }) {
  const { withCamera, withMic, stream, levels } = prejoin;
  const showing = withCamera && stream !== null;
  return (
    <div>
      <div aria-label="Prévia da câmera" className="cam-prev">
        {withCamera ? <div className="cam" /> : null}
        <video
          autoPlay
          className={`fill-video${showing ? "" : " is-off"}`}
          muted
          playsInline
          ref={prejoin.preview}
        />
        {showing ? null : (
          <div className="cam-sprite">
            <Sprite
              pose={withCamera ? "idle" : "sleep"}
              scale={6}
              who="capuz"
            />
          </div>
        )}
        {withCamera ? null : (
          <span className="pixel cam-off-label">Câmera desligada</span>
        )}
      </div>
      <div className="row prejoin-controls">
        <button
          aria-label={withMic ? "Silenciar microfone" : "Ativar microfone"}
          aria-pressed={withMic}
          className={`cbtn${withMic ? "" : " off"}`}
          onClick={prejoin.toggleMic}
          type="button"
        >
          <Icon name={withMic ? "mic" : "micOff"} />
        </button>
        <button
          aria-label={withCamera ? "Desligar câmera" : "Ligar câmera"}
          aria-pressed={withCamera}
          className={`cbtn${withCamera ? "" : " off"}`}
          onClick={prejoin.toggleCamera}
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
  );
}

function DeviceSelect({
  id,
  label,
  fallback,
  devices,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  fallback: string;
  devices: readonly MediaDeviceInfo[];
  value: string;
  disabled?: boolean;
  onChange: (deviceId: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        className="inp"
        disabled={disabled}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value="">Padrão</option>
        {devices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || fallback}
          </option>
        ))}
      </select>
    </div>
  );
}

/** What stands between the person and the call: browser support, locked keys, errors. */
function EncryptionNotice({
  supported,
  unlocked,
}: {
  supported: boolean;
  unlocked: boolean;
}) {
  if (!supported) {
    return (
      <Banner kind="err" role="alert">
        <b>
          Este navegador não suporta criptografia de ponta a ponta de mídia.
        </b>{" "}
        Para sua segurança, a chamada não segue sem E2EE e não há modo sem
        criptografia. Use Chrome ou Edge atuais no desktop.
      </Banner>
    );
  }
  if (!unlocked) {
    return (
      <Banner kind="warn" role="alert">
        Libere a criptografia deste navegador para participar. A chave da
        chamada é entregue só a dispositivos liberados.
      </Banner>
    );
  }
  return (
    <Banner icon="shieldOk" kind="ok">
      Navegador compatível. Áudio, câmera e tela saem cifrados com uma chave
      efêmera de chamada.
    </Banner>
  );
}

/** The screen before joining: preview on the left, devices and the join button on the right. */
export function PrejoinPanel({
  title,
  call,
  prejoin,
  supported,
  unlocked,
  encryptionReady,
  joining,
  needsTransfer,
  message,
  onJoin,
  onClose,
}: {
  title: string;
  call: Call | null;
  prejoin: Prejoin;
  supported: boolean;
  unlocked: boolean;
  encryptionReady: boolean;
  joining: boolean;
  needsTransfer: boolean;
  message: string;
  onJoin: (transfer: boolean) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="sh">
        <span className="brand">
          <Logo />
        </span>
        <h2 className="grow">Entrar em {title}</h2>
        <button
          aria-label="Cancelar"
          className="iconbtn"
          onClick={onClose}
          type="button"
        >
          <Icon name="x" />
        </button>
      </div>
      <div className="prejoin">
        <CameraPreview prejoin={prejoin} />
        <div className="col gap16">
          <div>
            <h1 className="call-heading tight">Pronto para entrar?</h1>
            <p className="call-dim call-subtitle">{prejoinSubtitle(call)}</p>
          </div>
          <DeviceSelect
            devices={prejoin.microphones}
            fallback="Microfone"
            id="dmic"
            label="Microfone"
            onChange={prejoin.setMicrophoneId}
            value={prejoin.microphoneId}
          />
          <DeviceSelect
            devices={prejoin.cameras}
            disabled={!prejoin.withCamera}
            fallback="Câmera"
            id="dcam"
            label="Câmera"
            onChange={prejoin.setCameraId}
            value={prejoin.cameraId}
          />
          <EncryptionNotice supported={supported} unlocked={unlocked} />
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
              className={`btn primary lg grow${joining ? " loading" : ""}`}
              disabled={joining || !encryptionReady}
              onClick={() => onJoin(false)}
              type="button"
            >
              <Icon name="phone" /> Entrar na chamada
            </button>
            {needsTransfer ? (
              <button
                className="btn ghost"
                onClick={() => onJoin(true)}
                type="button"
              >
                Transferir para este dispositivo
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
