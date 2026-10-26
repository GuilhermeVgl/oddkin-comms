import { useState } from "react";
import { Modal } from "../../design/Modal";
import { Banner } from "../../design/primitives";
import { blip } from "../../design/sound";
import { parseInviteForm } from "./rules";
import type { PendingInvitation } from "./types";

/** Takes the invitation code (or the whole link) and the e-mail it was sent to. */
export function InviteDialog({
  onClose,
  onOpen,
}: {
  onClose: () => void;
  onOpen: (invitation: PendingInvitation) => void;
}) {
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState(false);
  return (
    <Modal onClose={onClose}>
      <div className="dh">
        <h2 id="dlgt">Aceitar convite</h2>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = parseInviteForm(code, email);
          if (parsed === null) {
            setError(true);
            blip("err");
            return;
          }
          onClose();
          onOpen(parsed);
        }}
      >
        <div className="dbd col gap12">
          <div className="field">
            <label htmlFor="iv">Código do convite</label>
            <input
              autoComplete="off"
              className="inp mono"
              id="iv"
              onChange={(event) => setCode(event.target.value)}
              placeholder="Cole o código ou o link recebido"
              value={code}
            />
          </div>
          <div className="field">
            <label htmlFor="ie">Seu e-mail</label>
            <input
              className="inp"
              id="ie"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="voce@empresa.com"
              type="email"
              value={email}
            />
          </div>
          {error ? (
            <Banner kind="err" role="alert">
              <b>Não foi possível usar este convite.</b> Confira o código e o
              e-mail. Ele pode ter expirado, já ter sido usado ou pertencer a
              outro e-mail. Peça um novo convite a quem convidou você.
            </Banner>
          ) : null}
        </div>
        <div className="dft">
          <button className="btn" onClick={onClose} type="button">
            Cancelar
          </button>
          <button className="btn primary" type="submit">
            Validar
          </button>
        </div>
      </form>
    </Modal>
  );
}
