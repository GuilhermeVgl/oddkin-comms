import { logout, type CurrentAccount } from "@crewstead/api-client";
import { Banner } from "../../design/primitives";
import { confirmDialog } from "../../design/confirm";
import { toastError } from "../../design/toast";
import { useE2EE } from "../../e2ee/E2EE";
import { csrfToken } from "../../errors";
import { useShell } from "../../shell/context";
import { useWorkspace } from "../../workspace";
import { DeviceList, PendingApprovals } from "./DeviceRows";
import { SessionsCard } from "./SessionsCard";

function phaseTitle(phase: string): string {
  switch (phase) {
    case "locked":
      return "Este navegador está bloqueado";
    case "not_configured":
      return "A criptografia ainda não foi ativada";
    case "needs_device":
      return "Este navegador ainda não foi registrado";
    case "pending_approval":
      return "Este dispositivo aguarda liberação";
    default:
      return "Segurança deste navegador";
  }
}

function HistoryAccessCard() {
  const e2ee = useE2EE();
  return (
    <section className="card pad row">
      <div className="grow col">
        <b>Você entrou sem acesso ao histórico cifrado</b>
        <span className="xs muted">
          Por isso nenhuma chave é pedida. Se mudar de ideia, peça o acesso:
          este navegador será registrado e a administração o aprova.
        </span>
      </div>
      <button
        className="btn primary"
        onClick={() => void e2ee.requestHistoryAccess()}
        type="button"
      >
        Pedir acesso ao histórico
      </button>
    </section>
  );
}

function SecurityStatusCard({ account }: { account: CurrentAccount }) {
  const e2ee = useE2EE();
  const { openGate } = useShell();
  const waitingForAdmin = e2ee.phase === "not_configured" && !account.isAdmin;
  return (
    <section className="card pad row">
      <div className="grow col">
        <b>{phaseTitle(e2ee.phase)}</b>
        <span className="xs muted">
          {waitingForAdmin
            ? "A administração ainda não ativou a criptografia."
            : "Abra o assistente para continuar."}
        </span>
      </div>
      {waitingForAdmin ? null : (
        <button className="btn primary" onClick={openGate} type="button">
          Abrir assistente
        </button>
      )}
    </section>
  );
}

function LogoutAllCard({ onLogout }: { onLogout: () => void }) {
  const e2ee = useE2EE();
  const { client } = useWorkspace();
  return (
    <section className="card pad row">
      <div className="grow col">
        <b>Sessões</b>
        <span className="xs muted">
          Sessão opaca, 7 dias no máximo e 24 h sem atividade.
        </span>
      </div>
      <button
        className="btn danger"
        onClick={() => {
          void confirmDialog({
            title: "Sair de todas as sessões?",
            body: <p className="muted">Você será desconectado aqui também.</p>,
            ok: "Sair de tudo",
            danger: true,
          }).then(async (ok) => {
            if (ok !== true) return;
            try {
              e2ee.lock();
              await logout(client, csrfToken(), true);
              onLogout();
            } catch {
              toastError("Não foi possível encerrar as sessões.");
            }
          });
        }}
        type="button"
      >
        Sair de todas as sessões
      </button>
    </section>
  );
}

export function DevicesTab({
  account,
  onLogout,
}: {
  account: CurrentAccount;
  onLogout: () => void;
}) {
  const e2ee = useE2EE();
  if (e2ee.phase === "not_enabled") {
    return (
      <div className="stack">
        <HistoryAccessCard />
      </div>
    );
  }
  const ready = e2ee.phase === "unlocked";
  return (
    <div className="stack">
      <Banner icon="shield">
        Entrar na conta e conseguir descriptografar são coisas diferentes. Um
        dispositivo novo só lê o histórico depois de aprovado por um dispositivo
        confiável ou pelo administrador de recuperação.
      </Banner>
      {ready ? null : <SecurityStatusCard account={account} />}
      <PendingApprovals />
      <DeviceList ready={ready} />
      <LogoutAllCard onLogout={onLogout} />
      <SessionsCard onLogout={onLogout} />
    </div>
  );
}
