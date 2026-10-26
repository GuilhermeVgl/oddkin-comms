import type { RecoveryAuditEntry, RecoveryGap } from "@crewstead/api-client";
import { useState } from "react";
import { confirmDialog } from "../../design/confirm";
import { Icon } from "../../design/icons";
import { nameOf } from "../../design/people";
import { toast, toastError } from "../../design/toast";
import { useE2EE } from "../../e2ee/E2EE";
import { kindLabel } from "./settingsRules";

/** Saves the backup file and then shows, once, the key that opens it. */
function downloadBackup(made: { content: string; recoveryKey: string }) {
  const url = URL.createObjectURL(
    new Blob([made.content], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "crewstead-recuperacao.json";
  link.click();
  URL.revokeObjectURL(url);
  // The key opens the file and is shown only now: it is not stored anywhere.
  void confirmDialog({
    title: "Guarde a chave deste backup",
    body: (
      <>
        <p className="muted">
          O arquivo baixado só abre com esta chave. Anote-a e guarde-a fora
          deste computador e do servidor. Ela não será mostrada de novo.
        </p>
        <p className="fp st-fp-lg">{made.recoveryKey}</p>
      </>
    ),
    ok: "Anotei a chave",
  });
}

export function RecoveryIdentityCard() {
  const e2ee = useE2EE();
  return (
    <section className="card pad col gap12">
      <div className="row">
        <span className="av lg tint">
          <Icon name="key" />
        </span>
        <div className="grow col">
          <b>Identidade de recuperação</b>
          <span className="xs muted">
            Backup protegido por segredo forte, guardado fora do VPS e do R2.
            Não é variável de ambiente do servidor.
          </span>
        </div>
        <span className="tag lime">
          {e2ee.hasRecoveryIdentity
            ? "configurada"
            : "neste navegador: ausente"}
        </span>
      </div>
      <p className="xs muted">
        Se todos os dispositivos e o segredo de recuperação se perderem, o
        histórico pode ficar irrecuperável. Não há chave-mestra escondida no
        servidor.
      </p>
      {!e2ee.canBackup ? null : (
        <div>
          <button
            className="btn"
            onClick={() => {
              const made = e2ee.createBackup();
              if (made !== null) downloadBackup(made);
            }}
            type="button"
          >
            <Icon name="dl" size="sm" />
            Baixar backup de recuperação
          </button>
        </div>
      )}
    </section>
  );
}

export function RecoveryRequestsCard({
  gaps,
  onDone,
}: {
  gaps: RecoveryGap[];
  onDone: () => void;
}) {
  const e2ee = useE2EE();
  const [busy, setBusy] = useState(false);
  const people = [...new Set(gaps.map((gap) => gap.device.email))];

  async function approve() {
    const ok = await confirmDialog({
      title: "Aprovar recuperação?",
      body: (
        <p className="muted">
          Você confirma que verificou a identidade das pessoas fora do app. O
          material de recuperação é aberto localmente neste navegador e
          reencapsulado para os novos dispositivos. Cada uso fica registrado.
        </p>
      ),
      ok: "Aprovar e reencapsular",
    });
    if (ok !== true) return;
    setBusy(true);
    e2ee
      .restoreAccess()
      .then((result) =>
        toast(`Restaurado: ${result.granted}. Falhas: ${result.failed}.`, {
          icon: "key",
        }),
      )
      .catch(() => toastError("Não foi possível restaurar agora."))
      .finally(() => {
        setBusy(false);
        onDone();
      });
  }

  return (
    <section className="card pad">
      <h2 className="h2 st-h2-tight">Pedidos de recuperação</h2>
      {gaps.length === 0 ? (
        <p className="muted sm">Nenhum dispositivo está esperando chaves.</p>
      ) : (
        <>
          <p className="xs muted st-mb8">
            Dispositivos sem acesso ao histórico: {people.join(", ")}. Restaurar
            usa a identidade de recuperação, fica registrado e a pessoa é
            avisada.
          </p>
          {gaps.map((gap) => (
            <div
              className="list-i"
              key={`${gap.domainId}:${gap.generation}:${gap.device.deviceId}`}
            >
              <div className="grow col">
                <b>{nameOf(gap.device.email)}</b>
                <span className="xs muted">
                  {kindLabel(gap.kind)} · geração {gap.generation}
                </span>
              </div>
            </div>
          ))}
          <div className="row st-mt12">
            <button
              className={`btn primary${busy ? " loading" : ""}`}
              onClick={() => void approve()}
              type="button"
            >
              Verificar e aprovar
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export function RotateIdentityCard({ onDone }: { onDone: () => void }) {
  const e2ee = useE2EE();
  const [rotating, setRotating] = useState(false);
  return (
    <section className="card pad col gap8">
      <h2 className="h2">Trocar identidade de recuperação</h2>
      <p className="xs muted">
        A nova identidade recebe as chaves existentes antes de a atual ser
        revogada. A operação fica registrada.
      </p>
      <div>
        <button
          className={`btn${rotating ? " loading" : ""}`}
          onClick={() => {
            setRotating(true);
            e2ee
              .rotateRecoveryIdentity()
              .then(() => {
                toast("Identidade de recuperação trocada.", { icon: "key" });
              })
              .catch(() =>
                toastError(
                  "Não foi possível trocar a identidade. A atual continua ativa.",
                ),
              )
              .finally(() => {
                setRotating(false);
                onDone();
              });
          }}
          type="button"
        >
          Trocar identidade
        </button>
      </div>
    </section>
  );
}

export function RecoveryAuditCard({ audit }: { audit: RecoveryAuditEntry[] }) {
  return (
    <section className="card pad">
      <h2 className="h2 st-h2-tight">Auditoria</h2>
      {audit.length === 0 ? (
        <p className="muted sm">Nenhum uso registrado.</p>
      ) : null}
      <ul className="feed">
        {audit.slice(0, 20).map((entry) => (
          <li key={entry.id}>
            <span className="grow">
              {nameOf(entry.approverEmail)} → {nameOf(entry.recipientEmail)} ·{" "}
              {kindLabel(entry.domainKind)} g{entry.generation}
            </span>
            <time className="xs muted">
              {new Date(entry.createdAt).toLocaleString("pt-BR")}
            </time>
          </li>
        ))}
      </ul>
    </section>
  );
}
