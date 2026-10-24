import type { CurrentAccount } from "@oddkin/api-client";
import React, { useState } from "react";
import { useE2EE } from "./E2EE";

const MIN_PASSPHRASE = 12;

function download(name: string, content: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** Device keys, unlocking and approvals. The passphrase never leaves this browser. */
export function SecurityPanel({ account }: { account: CurrentAccount }) {
  const e2ee = useE2EE();
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, failure: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setPassphrase("");
      setConfirm("");
    } catch {
      setMessage(failure);
    } finally {
      setBusy(false);
    }
  }

  const passphraseFields = (withConfirm: boolean) => (
    <>
      <label htmlFor="e2ee-passphrase">Senha de proteção deste navegador</label>
      <input
        autoComplete="new-password"
        id="e2ee-passphrase"
        minLength={MIN_PASSPHRASE}
        onChange={(event) => setPassphrase(event.target.value)}
        required
        type="password"
        value={passphrase}
      />
      {withConfirm ? (
        <>
          <label htmlFor="e2ee-confirm">Repita a senha</label>
          <input
            autoComplete="new-password"
            id="e2ee-confirm"
            onChange={(event) => setConfirm(event.target.value)}
            required
            type="password"
            value={confirm}
          />
        </>
      ) : null}
    </>
  );

  const mismatch = passphrase !== confirm || passphrase.length < MIN_PASSPHRASE;

  return (
    <section aria-labelledby="security-title" className="security">
      <h2 id="security-title">Criptografia</h2>
      {!e2ee.persistent ? (
        <p className="form-message">
          Este navegador não guarda dados locais: as chaves se perdem ao fechar
          a página.
        </p>
      ) : null}

      {e2ee.phase === "loading" ? <p>Verificando…</p> : null}

      {e2ee.phase === "not_configured" && account.isAdmin ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () => e2ee.setupOrganization(passphrase),
              "Não foi possível ativar. Se já houver chave configurada, recarregue a página.",
            );
          }}
        >
          <p>
            Ative a criptografia da organização. Será criada a chave de
            confiança e a identidade de recuperação, protegidas pela senha
            abaixo. Guarde a senha e o arquivo de backup fora deste servidor:
            sem eles, o histórico não pode ser recuperado.
          </p>
          {passphraseFields(true)}
          <button disabled={busy || mismatch} type="submit">
            Ativar criptografia
          </button>
        </form>
      ) : null}
      {e2ee.phase === "not_configured" && !account.isAdmin ? (
        <p className="empty-note">
          A administração ainda não ativou a criptografia.
        </p>
      ) : null}

      {e2ee.phase === "needs_device" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () => e2ee.setupDevice(passphrase, fingerprint),
              "O fingerprint não confere com o do servidor ou o registro falhou.",
            );
          }}
        >
          <p>
            Registre este navegador. Confira o fingerprint abaixo com a
            administração, por outro canal, e digite-o para confirmar.
          </p>
          <p>
            <code>{e2ee.rootFingerprint}</code>
          </p>
          <label htmlFor="e2ee-fingerprint">Fingerprint da organização</label>
          <input
            autoComplete="off"
            id="e2ee-fingerprint"
            onChange={(event) => setFingerprint(event.target.value)}
            required
            value={fingerprint}
          />
          {passphraseFields(true)}
          <button disabled={busy || mismatch} type="submit">
            Registrar este navegador
          </button>
        </form>
      ) : null}

      {e2ee.phase === "pending_approval" ? (
        <>
          <p>
            Aguardando liberação. Compare este fingerprint quando alguém for
            aprovar:
          </p>
          <p>
            <code>{e2ee.deviceFingerprint}</code>
          </p>
        </>
      ) : null}

      {e2ee.phase === "locked" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              if (!(await e2ee.unlock(passphrase))) throw new Error("wrong");
            }, "Senha incorreta.");
          }}
        >
          <p>Desbloqueie para ler e escrever conteúdo cifrado.</p>
          {passphraseFields(false)}
          <button disabled={busy} type="submit">
            Desbloquear
          </button>
        </form>
      ) : null}

      {e2ee.phase === "unlocked" ? (
        <>
          <p>Desbloqueado neste navegador.</p>
          <p>
            Este dispositivo: <code>{e2ee.deviceFingerprint}</code>
          </p>
          <button
            className="text-button"
            onClick={() => e2ee.lock()}
            type="button"
          >
            Bloquear
          </button>
          {e2ee.backup() !== null ? (
            <button
              className="text-button"
              onClick={() => {
                const content = e2ee.backup();
                if (content !== null)
                  download("oddkin-recuperacao.json", content);
              }}
              type="button"
            >
              Baixar backup de recuperação
            </button>
          ) : null}
          {e2ee.approvals.length > 0 ? (
            <div>
              <h3>Dispositivos aguardando liberação</h3>
              <ul>
                {e2ee.approvals.map((approval) => (
                  <li key={approval.deviceId}>
                    {approval.email} · {approval.name}
                    <br />
                    <code>{approval.fingerprint}</code>{" "}
                    <button
                      className="text-button"
                      onClick={() =>
                        void run(
                          () => e2ee.approve(approval),
                          "Este navegador não pode aprovar esse dispositivo.",
                        )
                      }
                      type="button"
                    >
                      Conferi o fingerprint, aprovar
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <h3>Seus dispositivos</h3>
          <ul>
            {e2ee.devices.map((device) => (
              <li key={device.id}>
                {device.name} ·{" "}
                {device.state === "active" ? "ativo" : "aguardando"}{" "}
                <button
                  className="text-button"
                  onClick={() =>
                    void run(
                      () => e2ee.revoke(device.id),
                      "Não foi possível revogar.",
                    )
                  }
                  type="button"
                >
                  Revogar
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {e2ee.phase === "revoked" ? (
        <>
          <p>Este dispositivo foi revogado ou removido.</p>
          <button
            className="text-button"
            onClick={() => void e2ee.resetThisBrowser()}
            type="button"
          >
            Esquecer este navegador
          </button>
        </>
      ) : null}

      {e2ee.phase === "error" ? (
        <p className="form-message">{e2ee.error}</p>
      ) : null}
      <p aria-live="polite" className="form-message">
        {message}
      </p>
    </section>
  );
}
