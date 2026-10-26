import { createApiClient, requestPasswordReset } from "@crewstead/api-client";
import { useMemo, useState } from "react";
import { Modal } from "../../design/Modal";
import { Banner } from "../../design/primitives";
import { toast, toastError } from "../../design/toast";
import { resetRequestOutcome } from "./rules";

/** Asks for a password reset link. */
export function ForgotDialog({ onClose }: { onClose: () => void }) {
  const client = useMemo(() => createApiClient(""), []);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal onClose={onClose}>
      <div className="dh">
        <h2 id="dlgt">Redefinir senha</h2>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          requestPasswordReset(client, email)
            .then((result) => {
              onClose();
              const outcome = resetRequestOutcome(result);
              if (outcome.failed) toastError(outcome.message);
              else toast(outcome.message, { icon: "mail" });
            })
            .catch(() => {
              setBusy(false);
              toastError("Não foi possível pedir o link agora.");
            });
        }}
      >
        <div className="dbd col gap12">
          <p className="muted">
            Enviaremos um link de uso único, válido por uma hora. A resposta é a
            mesma para qualquer e-mail, assim ninguém descobre quem tem conta.
          </p>
          <div className="field">
            <label htmlFor="fe">E-mail</label>
            <input
              autoComplete="username"
              className="inp"
              id="fe"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </div>
          <Banner>
            Redefinir a senha <b>não restaura o histórico cifrado</b>. Depois,
            este dispositivo ainda precisa ser liberado.
          </Banner>
        </div>
        <div className="dft">
          <button className="btn" onClick={onClose} type="button">
            Cancelar
          </button>
          <button
            className={`btn primary${busy ? " loading" : ""}`}
            type="submit"
          >
            Enviar link
          </button>
        </div>
      </form>
    </Modal>
  );
}
