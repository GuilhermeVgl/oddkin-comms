import {
  ApiStatusError,
  renameChannel,
  reorderChannels,
  setChannelArchived,
  type Conversation,
} from "@crewstead/api-client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../design/icons";
import { Menu } from "../design/Menu";
import { toast } from "../design/toast";
import { createChannelNamed, encryptChannel } from "../e2ee/content";
import { csrfToken, describeError } from "../errors";
import { useInbox, type Channel } from "../inbox";
import { useWorkspace, type ProjectState } from "../workspace";

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
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(
    null,
  );

  async function act(action: () => Promise<void>, done?: string) {
    try {
      await action();
      await reloadChat();
      if (done !== undefined) toast(done, { icon: "check" });
    } catch (error) {
      toast(
        error instanceof ApiStatusError && error.status === 409
          ? "Já existe um canal com esse nome, ou o projeto está arquivado."
          : describeError(error),
        { kind: "err" },
      );
    }
  }

  function reorder(ids: string[]) {
    void act(() => reorderChannels(client, csrfToken(), state.project.id, ids));
  }

  function move(id: string, offset: number) {
    const ids = mine.map((entry) => entry.id);
    const from = ids.indexOf(id);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ids.splice(from, 1)[0] ?? id);
    reorder(ids);
  }

  function drop(targetId: string, after: boolean) {
    if (dragging === null || dragging === targetId) return;
    const ids = mine.map((entry) => entry.id).filter((id) => id !== dragging);
    const at = ids.indexOf(targetId) + (after ? 1 : 0);
    ids.splice(at, 0, dragging);
    reorder(ids);
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
        await encryptChannel(client, csrfToken(), state.crypto, asConversation);
      } else {
        await renameChannel(client, csrfToken(), entry.id, name);
      }
    });
  }

  function create(raw: string) {
    setAdding(false);
    const name = raw.trim();
    if (name === "") return;
    void act(
      () =>
        createChannelNamed(
          client,
          csrfToken(),
          state.project.id,
          state.crypto,
          name,
        ),
      "Canal criado.",
    );
  }

  const menuEntry =
    menu === null ? undefined : mine.find((entry) => entry.id === menu.id);
  const menuIndex = menuEntry === undefined ? -1 : mine.indexOf(menuEntry);

  return (
    <div>
      <h4 className="row">
        <span className="grow">{state.project.name}</span>
        {manager ? (
          <button
            aria-label={`Novo canal em ${state.project.name}`}
            className="iconbtn"
            onClick={() => setAdding(true)}
            title="Novo canal"
            type="button"
          >
            <Icon name="plus" size="sm" />
          </button>
        ) : null}
      </h4>
      {mine.map((entry) => {
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
              <InlineName
                initial={entry.name}
                label={`Novo nome de ${entry.name}`}
                onCancel={() => setEditing(null)}
                onSave={(value) => save(entry, value)}
              />
            ) : (
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
                  <span aria-label={`${entry.unread} não lidas`} className="u">
                    {entry.unread}
                  </span>
                ) : null}
              </button>
            )}
            {manager && editing !== entry.id ? (
              <button
                aria-haspopup="menu"
                aria-label={`Ações de ${entry.name}`}
                className="iconbtn crow-more"
                onClick={(event) =>
                  setMenu({ id: entry.id, anchor: event.currentTarget })
                }
                type="button"
              >
                <Icon name="more" size="sm" />
              </button>
            ) : null}
          </div>
        );
      })}
      {adding ? (
        <div className="crow">
          <InlineName
            initial=""
            label="Nome do novo canal"
            onCancel={() => setAdding(false)}
            onSave={create}
            placeholder="novo-canal"
          />
        </div>
      ) : null}
      {menu !== null && menuEntry !== undefined ? (
        <Menu anchor={menu.anchor} onClose={() => setMenu(null)} right>
          <button
            onClick={() => {
              setMenu(null);
              setEditing(menuEntry.id);
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="edit" size="sm" />
            Renomear
          </button>
          <button
            disabled={menuIndex <= 0}
            onClick={() => {
              setMenu(null);
              move(menuEntry.id, -1);
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="up" size="sm" />
            Mover para cima
          </button>
          <button
            disabled={menuIndex < 0 || menuIndex >= mine.length - 1}
            onClick={() => {
              setMenu(null);
              move(menuEntry.id, 1);
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="down" size="sm" />
            Mover para baixo
          </button>
          <button
            onClick={() => {
              setMenu(null);
              void act(
                () =>
                  setChannelArchived(
                    client,
                    csrfToken(),
                    menuEntry.id,
                    !menuEntry.archived,
                  ),
                menuEntry.archived
                  ? "Canal restaurado."
                  : "Canal arquivado: agora é só leitura.",
              );
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="lock" size="sm" />
            {menuEntry.archived ? "Restaurar" : "Arquivar"}
          </button>
        </Menu>
      ) : null}
    </div>
  );
}

/** A text field that saves on Enter or when it loses focus, and cancels on Escape. */
function InlineName({
  initial,
  label,
  placeholder,
  onSave,
  onCancel,
}: {
  initial: string;
  label: string;
  placeholder?: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const settled = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (save: boolean) => {
    if (settled.current) return;
    settled.current = true;
    if (save) onSave(input.current?.value ?? "");
    else onCancel();
  };
  return (
    <input
      aria-label={label}
      className="inp crow-input"
      defaultValue={initial}
      maxLength={60}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      }}
      placeholder={placeholder}
      ref={input}
    />
  );
}
