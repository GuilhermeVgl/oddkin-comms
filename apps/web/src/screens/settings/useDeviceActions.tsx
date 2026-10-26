import { confirmDialog } from "../../design/confirm";
import { toast, toastError } from "../../design/toast";
import { useE2EE } from "../../e2ee/E2EE";

/** Approving and revoking a device, each behind its own confirmation. */
export function useDeviceActions() {
  const e2ee = useE2EE();

  async function approve(index: number) {
    const approval = e2ee.approvals[index];
    if (approval === undefined) return;
    const ok = await confirmDialog({
      title: "Aprovar este dispositivo?",
      body: (
        <>
          <p className="muted">
            Confira se a impressão digital é a mesma exibida no dispositivo
            novo:
          </p>
          <p className="fp st-fp-md">{approval.fingerprint}</p>
        </>
      ),
      ok: "Sequências iguais, aprovar",
    });
    if (ok !== true) return;
    try {
      await e2ee.approve(approval);
      toast("Dispositivo aprovado. Envelopes assinados serão entregues.", {
        icon: "shieldOk",
      });
    } catch {
      toastError("Este navegador não pode aprovar esse dispositivo.");
    }
  }

  async function revoke(id: string, name: string) {
    const ok = await confirmDialog({
      title: `Revogar ${name}?`,
      body: (
        <p className="muted">
          Sessões e conexões deste dispositivo caem agora e ele não recebe novos
          envelopes. Conteúdo já descriptografado nele não pode ser apagado à
          distância.
        </p>
      ),
      ok: "Revogar",
      danger: true,
    });
    if (ok !== true) return;
    try {
      await e2ee.revoke(id);
      toast("Dispositivo revogado.", { icon: "lock" });
    } catch {
      toastError("Não foi possível revogar.");
    }
  }

  return { approve, revoke };
}
