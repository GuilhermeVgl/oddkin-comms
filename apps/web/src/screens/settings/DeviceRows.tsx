import { useState } from "react";
import { Icon } from "../../design/icons";
import { nameOf } from "../../design/people";
import { useE2EE } from "../../e2ee/E2EE";
import { deviceIconName } from "./settingsRules";
import { useDeviceActions } from "./useDeviceActions";

export function PendingApprovals() {
  const e2ee = useE2EE();
  const { approve, revoke } = useDeviceActions();
  if (e2ee.approvals.length === 0) return null;
  return (
    <section className="card pad">
      <h2 className="h2 st-h2-tight">Aguardando liberação</h2>
      {e2ee.approvals.map((approval, index) => (
        <div className="list-i" key={approval.deviceId}>
          <span className="av lg tint">
            <Icon name="laptop" />
          </span>
          <div className="grow col">
            <b>
              {nameOf(approval.email)} · {approval.name}
              <span className="tag warn st-ml6">aguardando liberação</span>
            </b>
            <span className="fp">{approval.fingerprint}</span>
          </div>
          <button
            className="btn sm primary"
            onClick={() => void approve(index)}
            type="button"
          >
            Aprovar
          </button>
          <button
            className="btn sm"
            onClick={() => void revoke(approval.deviceId, approval.name)}
            type="button"
          >
            Recusar
          </button>
        </div>
      ))}
    </section>
  );
}

export function DeviceList({ ready }: { ready: boolean }) {
  const e2ee = useE2EE();
  const { revoke } = useDeviceActions();
  const [busy, setBusy] = useState(false);
  return (
    <section className="card pad">
      {e2ee.devices.length === 0 ? (
        <p className="muted sm">Nenhum dispositivo registrado.</p>
      ) : null}
      {e2ee.devices.map((device) => (
        <div className="list-i" key={device.id}>
          <span className="av lg tint">
            <Icon name={deviceIconName(device.name)} />
          </span>
          <div className="grow col">
            <b>
              {device.name}
              {device.state === "pending" ? (
                <span className="tag warn"> aguardando liberação</span>
              ) : null}
            </b>
            <span className="xs muted">
              {device.kind === "recovery"
                ? "Identidade de recuperação"
                : "Dispositivo"}
            </span>
          </div>
          <button
            className="btn sm danger"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void revoke(device.id, device.name).finally(() => setBusy(false));
            }}
            type="button"
          >
            Revogar
          </button>
        </div>
      ))}
      {ready && e2ee.deviceFingerprint !== null ? (
        <div className="list-i">
          <span className="av lg tint">
            <Icon name="key" />
          </span>
          <div className="grow col">
            <b>
              Este navegador <span className="tag lime">este dispositivo</span>
            </b>
            <span className="fp">{e2ee.deviceFingerprint}</span>
          </div>
          {e2ee.autoManaged ? null : (
            <button
              className="btn sm"
              onClick={() => e2ee.lock()}
              type="button"
            >
              Bloquear
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}
