import { reorderChannels, setChannelArchived } from "@oddkin/api-client";
import { useState } from "react";
import { createChannelNamed } from "../e2ee/content";
import { Icon } from "../design/icons";
import { Modal } from "../design/Modal";
import { toast } from "../design/toast";
import { csrfToken, describeError } from "../errors";
import { useInbox, type Channel } from "../inbox";
import { useWorkspace, type ProjectState } from "../workspace";

/** Managers create, order and archive the channels of one project. */
export function ChannelsDialog({
  state,
  onClose,
}: {
  state: ProjectState;
  onClose: () => void;
}) {
  const { client } = useWorkspace();
  const { channels, reloadChat } = useInbox();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const mine = channels.filter((entry) => entry.projectId === state.project.id);

  async function act(action: () => Promise<void>, done: string) {
    setBusy(true);
    try {
      await action();
      await reloadChat();
      toast(done, { icon: "check" });
    } catch (error) {
      toast(describeError(error), { kind: "err" });
    } finally {
      setBusy(false);
    }
  }

  function move(entry: Channel, offset: number) {
    const ids = mine.map((value) => value.id);
    const from = ids.indexOf(entry.id);
    const to = from + offset;
    if (to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ids.splice(from, 1)[0] ?? entry.id);
    void act(
      () => reorderChannels(client, csrfToken(), state.project.id, ids),
      "Ordem atualizada.",
    );
  }

  return (
    <Modal onClose={onClose}>
      <div className="dh">
        <h2 id="dlgt">Canais de {state.project.name}</h2>
      </div>
      <div className="dbd col gap12">
        <ul
          aria-label="Canais"
          className="col gap8"
          style={{ listStyle: "none", padding: 0 }}
        >
          {mine.map((entry, index) => (
            <li className="row gap8" key={entry.id}>
              <Icon name="hash" size="sm" />
              <span
                className="grow"
                style={entry.archived ? { opacity: 0.6 } : undefined}
              >
                {entry.name}
                {entry.archived ? " (arquivado)" : ""}
              </span>
              <button
                aria-label={`Subir ${entry.name}`}
                className="iconbtn"
                disabled={busy || index === 0}
                onClick={() => move(entry, -1)}
                type="button"
              >
                <Icon name="chevron-up" size="sm" />
              </button>
              <button
                aria-label={`Descer ${entry.name}`}
                className="iconbtn"
                disabled={busy || index === mine.length - 1}
                onClick={() => move(entry, 1)}
                type="button"
              >
                <Icon name="chevron-down" size="sm" />
              </button>
              <button
                className="btn sm"
                disabled={busy}
                onClick={() =>
                  void act(
                    () =>
                      setChannelArchived(
                        client,
                        csrfToken(),
                        entry.id,
                        !entry.archived,
                      ),
                    entry.archived
                      ? "Canal restaurado."
                      : "Canal arquivado: agora é só leitura.",
                  )
                }
                type="button"
              >
                {entry.archived ? "Restaurar" : "Arquivar"}
              </button>
            </li>
          ))}
        </ul>
        <form
          className="row gap8"
          onSubmit={(event) => {
            event.preventDefault();
            const value = name.trim();
            if (value === "") return;
            void act(
              () =>
                createChannelNamed(
                  client,
                  csrfToken(),
                  state.project.id,
                  state.crypto,
                  value,
                ),
              "Canal criado.",
            ).then(() => setName(""));
          }}
        >
          <input
            aria-label="Nome do novo canal"
            className="inp grow"
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            placeholder="novo-canal"
            value={name}
          />
          <button className="btn primary" disabled={busy} type="submit">
            Criar
          </button>
        </form>
        <p className="xs muted">
          Sem canais privados: todos os membros veem os canais do projeto.
        </p>
      </div>
      <div className="dft">
        <button className="btn" onClick={onClose} type="button">
          Fechar
        </button>
      </div>
    </Modal>
  );
}
