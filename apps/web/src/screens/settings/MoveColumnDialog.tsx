import type { BoardColumn } from "@crewstead/api-client";
import { useState } from "react";
import { Modal } from "../../design/Modal";

export function MoveColumnDialog({
  column,
  rest,
  held,
  onFinish,
}: {
  column: BoardColumn;
  rest: BoardColumn[];
  held: number;
  onFinish: (value: string | null) => void;
}) {
  const [to, setTo] = useState(rest[0]?.id ?? "");
  return (
    <Modal onClose={() => onFinish(null)} width="460px">
      <div className="dh">
        <h2 id="dlgt">Excluir “{column.name}”?</h2>
      </div>
      <div className="dbd col gap12">
        <p className="muted">
          Há {held} {held === 1 ? "atividade" : "atividades"} nela. Escolha a
          coluna de destino. A movimentação acontece numa única transação.
        </p>
        <div className="field">
          <label htmlFor="cd">Mover para</label>
          <select
            className="inp"
            id="cd"
            onChange={(event) => setTo(event.target.value)}
            value={to}
          >
            {rest.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="dft">
        <button className="btn" onClick={() => onFinish(null)} type="button">
          Cancelar
        </button>
        <button
          className="btn danger"
          onClick={() => onFinish(to)}
          type="button"
        >
          Mover e excluir
        </button>
      </div>
    </Modal>
  );
}
