import type { Message } from "@crewstead/api-client";
import { useState } from "react";
import { Modal } from "../../design/Modal";

export function EditDialog({
  message,
  onClose,
  onSave,
}: {
  message: Message;
  onClose: () => void;
  onSave: (body: string) => void;
}) {
  const [body, setBody] = useState(message.body);
  return (
    <Modal onClose={onClose} width="480px">
      <div className="dh">
        <h2 id="dlgt">Editar mensagem</h2>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (body.trim() !== "") onSave(body.trim());
        }}
      >
        <div className="dbd">
          <textarea
            aria-label="Mensagem"
            autoFocus
            className="inp"
            maxLength={10000}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            value={body}
          />
        </div>
        <div className="dft">
          <button className="btn" onClick={onClose} type="button">
            Cancelar
          </button>
          <button className="btn primary" type="submit">
            Salvar
          </button>
        </div>
      </form>
    </Modal>
  );
}
