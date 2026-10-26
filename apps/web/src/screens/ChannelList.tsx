import {
  ApiStatusError,
  renameChannel,
  reorderChannels,
  setChannelArchived,
  type Conversation,
} from "@crewstead/api-client";
import { useState } from "react";
import { Icon } from "../design/icons";
import { toast, toastError } from "../design/toast";
import { createChannelNamed, encryptChannel } from "../e2ee/content";
import { describeError } from "../errors";
import { useInbox, type Channel } from "../inbox";
import { useWorkspace, type ProjectState } from "../workspace";
import { idsAfterDrop, idsAfterMove } from "./channels/channelOrder";
import { InlineName } from "./channels/InlineName";

/**
 * The channels of one project, with everything a manager needs right in the
 * column: drag to reorder (or the menu, for keyboard and touch), add a channel
 * in place, rename in place, archive and restore. Everyone else just sees and
 * opens channels.
 */
export function ChannelList({
  state,
  selectedId,
  onOpen,
}: {
  state: ProjectState;
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  const { client } = useWorkspace();
  const { channels, reloadChat } = useInbox();
  const manager = state.project.isManager && !state.project.archived;
  const mine = channels.filter((entry) => entry.projectId === state.project.id);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);

  async function act(action: () => Promise<void>, done?: string) {
    try {
      await action();
      await reloadChat();
      if (done !== undefined) toast(done, { icon: "check" });
    } catch (error) {
      toastError(
        error instanceof ApiStatusError && error.status === 409
          ? "Já existe um canal com esse nome, ou o projeto está arquivado."
          : describeError(error),
      );
    }
  }

  function reorder(ids: string[]) {
    void act(() => reorderChannels(client, state.project.id, ids));
  }

  function move(id: string, offset: number) {
    const ids = idsAfterMove(
      mine.map((entry) => entry.id),
      id,
      offset,
    );
    if (ids !== null) reorder(ids);
  }

  function drop(targetId: string, after: boolean) {
    const ids = idsAfterDrop(
      mine.map((entry) => entry.id),
      dragging,
      targetId,
      after,
    );
    if (ids !== null) reorder(ids);
  }

  function save(entry: Channel, raw: string) {
    setEditing(null);
    const name = raw.trim();
    if (name === "" || name === entry.name) return;
    void act(async () => {
      if (entry.encrypted) {
        if (state.crypto === null || !state.crypto.canWrite("chat"))
          throw new Error("Desbloqueie este navegador para renomear.");
        const asConversation: Conversation = {
          id: entry.id,
          name,
          unread: 0,
          encrypted: true,
          contentRevision: entry.contentRevision,
        };
        await encryptChannel(client, state.crypto, asConversation);
      } else {
        await renameChannel(client, entry.id, name);
      }
    });
  }

  function create(raw: string) {
    setAdding(false);
    const name = raw.trim();
    if (name === "") return;
    void act(
      () => createChannelNamed(client, state.project.id, state.crypto, name),
      "Canal criado.",
    );
  }

  return (
    <div>
      <h4 className="row">
        <span className="grow">{state.project.name}</span>
        {manager ? (
          <button
            aria-label={`Novo canal em ${state.project.name}`}
            className="cghost"
            onClick={() => setAdding(true)}
            title="Novo canal"
            type="button"
          >
            <Icon name="plus" size="sm" />
          </button>
        ) : null}
      </h4>
      {mine.map((entry, index) => {
        const label = entry.archived ? `${entry.name} (arquivado)` : entry.name;
        const indicator =
          over?.id === entry.id && dragging !== entry.id
            ? over.after
              ? "after"
              : "before"
            : undefined;
        return (
          <div
            className="crow"
            data-archived={entry.archived ? "true" : undefined}
            data-drop={indicator}
            draggable={manager && editing !== entry.id}
            key={entry.id}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
            onDragOver={(event) => {
              if (dragging === null) return;
              event.preventDefault();
              const box = event.currentTarget.getBoundingClientRect();
              setOver({
                id: entry.id,
                after: event.clientY > box.top + box.height / 2,
              });
            }}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", entry.id);
              setDragging(entry.id);
            }}
            onDrop={(event) => {
              event.preventDefault();
              drop(entry.id, over?.after ?? false);
              setDragging(null);
              setOver(null);
            }}
          >
            {editing === entry.id ? (
              <>
                <Icon name="hash" size="sm" />
                <InlineName
                  initial={entry.name}
                  label={`Novo nome de ${entry.name}`}
                  onCancel={() => setEditing(null)}
                  onSave={(value) => save(entry, value)}
                />
                <span className="ctools">
                  <button
                    aria-label="Mover para cima"
                    className="cghost"
                    disabled={index === 0}
                    onClick={() => move(entry.id, -1)}
                    onMouseDown={(event) => event.preventDefault()}
                    title="Mover para cima"
                    type="button"
                  >
                    <Icon name="up" size="sm" />
                  </button>
                  <button
                    aria-label="Mover para baixo"
                    className="cghost"
                    disabled={index === mine.length - 1}
                    onClick={() => move(entry.id, 1)}
                    onMouseDown={(event) => event.preventDefault()}
                    title="Mover para baixo"
                    type="button"
                  >
                    <Icon name="down" size="sm" />
                  </button>
                  <button
                    aria-label={
                      entry.archived ? "Restaurar canal" : "Arquivar canal"
                    }
                    className="cghost"
                    onClick={() => {
                      setEditing(null);
                      void act(
                        () =>
                          setChannelArchived(client, entry.id, !entry.archived),
                        entry.archived
                          ? "Canal restaurado."
                          : "Canal arquivado: agora é só leitura.",
                      );
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    title={entry.archived ? "Restaurar" : "Arquivar"}
                    type="button"
                  >
                    <Icon name="lock" size="sm" />
                  </button>
                </span>
              </>
            ) : (
              <>
                <button
                  aria-current={entry.id === selectedId ? "true" : undefined}
                  className="citem"
                  onClick={() => onOpen(entry.id)}
                  onDoubleClick={() =>
                    manager ? setEditing(entry.id) : undefined
                  }
                  type="button"
                >
                  <Icon name="hash" size="sm" />
                  <span>{label}</span>
                  {entry.unread > 0 ? (
                    <span
                      aria-label={`${entry.unread} não lidas`}
                      className="u"
                    >
                      {entry.unread}
                    </span>
                  ) : null}
                </button>
                {manager ? (
                  <button
                    aria-label={`Editar ${entry.name}`}
                    className="cghost cedit"
                    onClick={() => setEditing(entry.id)}
                    title="Editar"
                    type="button"
                  >
                    <Icon name="edit" size="sm" />
                  </button>
                ) : null}
              </>
            )}
          </div>
        );
      })}
      {adding ? (
        <div className="crow">
          <Icon name="hash" size="sm" />
          <InlineName
            initial=""
            label="Nome do novo canal"
            onCancel={() => setAdding(false)}
            onSave={create}
            placeholder="novo-canal"
          />
        </div>
      ) : null}
    </div>
  );
}
