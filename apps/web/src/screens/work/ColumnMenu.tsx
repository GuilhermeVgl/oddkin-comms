import { updateBoardColumn, type BoardColumn } from "@crewstead/api-client";
import { useState } from "react";
import { Icon } from "../../design/icons";
import { Menu } from "../../design/Menu";
import { Modal } from "../../design/Modal";
import { go } from "../../design/router";
import { toast } from "../../design/toast";
import { useWorkspace, type ProjectState } from "../../workspace";

export function ColumnMenu({
  anchor,
  column,
  state,
  onClose,
}: {
  anchor: HTMLElement;
  column: BoardColumn;
  state: ProjectState;
  onClose: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  return (
    <>
      <Menu anchor={anchor} onClose={onClose} right>
        <button
          onClick={() => {
            setRenaming(true);
          }}
          role="menuitem"
          type="button"
        >
          <Icon name="edit" size="sm" />
          Renomear coluna
        </button>
        <button
          onClick={() => {
            onClose();
            go("settings/colunas");
          }}
          role="menuitem"
          type="button"
        >
          <Icon name="gear" size="sm" />
          Gerenciar colunas…
        </button>
      </Menu>
      {renaming ? (
        <RenameColumn
          column={column}
          onClose={() => {
            setRenaming(false);
            onClose();
          }}
          state={state}
        />
      ) : null}
    </>
  );
}

function RenameColumn({
  column,
  state,
  onClose,
}: {
  column: BoardColumn;
  state: ProjectState;
  onClose: () => void;
}) {
  const { client, run } = useWorkspace();
  const [name, setName] = useState(column.name);
  return (
    <Modal onClose={onClose} width="420px">
      <div className="dh">
        <h2 id="dlgt">Renomear coluna</h2>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const value = name.trim();
          if (value === "") return;
          onClose();
          void run(() =>
            updateBoardColumn(client, state.project.id, column.id, {
              name: value,
            }),
          ).then((done) => done !== undefined && toast("Coluna renomeada."));
        }}
      >
        <div className="dbd">
          <div className="field">
            <label htmlFor="rn">Nome</label>
            <input
              autoFocus
              className="inp"
              id="rn"
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </div>
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
