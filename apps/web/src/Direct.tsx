import {
  createApiClient,
  getConversationKeyDomain,
  listDirectContacts,
  listDirectConversations,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  openDirectConversation,
  readCookie,
  type CurrentAccount,
  type DirectContact,
  type DirectConversation,
  type Notification,
} from "@oddkin/api-client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ConversationView } from "./Chat";
import { useOptionalE2EE } from "./e2ee/E2EE";
import { migrateOwnMessages } from "./e2ee/content";
import type { ProjectCrypto } from "./e2ee/projectCrypto";
import { useEvents } from "./events";

const NOTIFICATION_LABEL: Record<string, string> = {
  mention: "Você foi mencionado",
  assignment: "Uma atividade foi atribuída a você",
  call_invite: "Você foi chamado para uma conversa por voz e vídeo",
  recovery_access: "A administração restaurou seu acesso ao histórico cifrado",
  direct_message: "Nova mensagem direta",
};

export function DirectArea({ account }: { account: CurrentAccount }) {
  const client = useMemo(() => createApiClient(""), []);
  const [contacts, setContacts] = useState<DirectContact[]>([]);
  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const [active, setActive] = useState<DirectConversation | null>(null);
  const [message, setMessage] = useState("");
  const e2ee = useOptionalE2EE();
  const unlocked = e2ee?.phase === "unlocked";
  const [dmCrypto, setDmCrypto] = useState<ProjectCrypto | null>(null);
  const [keyedOnServer, setKeyedOnServer] = useState(false);
  const [dmStatus, setDmStatus] = useState("");
  const [dmRefresh, setDmRefresh] = useState(0);

  const reload = useCallback(async () => {
    try {
      const [people, existing] = await Promise.all([
        listDirectContacts(client),
        listDirectConversations(client),
      ]);
      setContacts(people);
      setConversations(existing);
    } catch {
      setMessage("Não foi possível carregar as mensagens diretas.");
    }
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEvents((event) => {
    if (event === "resync" || event.eventType === "message.created") {
      void reload();
    }
    if (event === "resync" || event.eventType === "key-domain.changed") {
      setDmRefresh((value) => value + 1);
    }
  });

  const activeId = active?.id;
  useEffect(() => {
    let alive = true;
    setDmCrypto(null);
    if (activeId === undefined) {
      setKeyedOnServer(false);
      return undefined;
    }
    getConversationKeyDomain(client, activeId)
      .then(
        (domain) =>
          alive && setKeyedOnServer((domain?.currentGeneration ?? 0) > 0),
      )
      .catch(() => alive && setKeyedOnServer(false));
    if (unlocked && e2ee !== null) {
      e2ee
        .openConversation(activeId, { maintain: true })
        .then((opened) => alive && setDmCrypto(opened))
        .catch(() => alive && setDmCrypto(null));
    }
    return () => {
      alive = false;
    };
  }, [client, activeId, unlocked, e2ee, dmRefresh]);

  async function enableDm() {
    if (dmCrypto === null || active === null) return;
    const csrf = readCookie(document.cookie, "oddkin_csrf");
    if (csrf === null) return;
    setDmStatus("Ativando…");
    try {
      await dmCrypto.enable(() => csrf);
      const result = await migrateOwnMessages(
        client,
        csrf,
        dmCrypto,
        active.id,
        account.email,
        "dm",
      );
      setDmStatus(
        `Conversa cifrada. ${result.migrated} mensagens suas antigas foram cifradas.`,
      );
      setDmRefresh((value) => value + 1);
    } catch {
      setDmStatus("Não foi possível ativar. Tente de novo.");
    }
  }

  async function open(contact: DirectContact) {
    const csrf = readCookie(document.cookie, "oddkin_csrf");
    if (csrf === null) return;
    try {
      const conversation = await openDirectConversation(
        client,
        csrf,
        contact.accountId,
      );
      setActive(conversation);
      setMessage("");
      await reload();
    } catch {
      setMessage("Você não pode conversar com esta pessoa agora.");
    }
  }

  const unreadOf = (accountId: string) =>
    conversations.find((entry) => entry.peerId === accountId)?.unread ?? 0;

  return (
    <section className="direct" aria-labelledby="direct-title">
      <h2 id="direct-title">Mensagens diretas</h2>
      <p aria-live="polite" className="form-message">
        {message}
      </p>
      {contacts.length === 0 ? (
        <p className="empty-note">
          Você verá aqui pessoas que compartilham um projeto com você.
        </p>
      ) : null}
      <ul className="contacts">
        {contacts.map((contact) => (
          <li key={contact.accountId}>
            <button
              className="project-tab"
              onClick={() => void open(contact)}
              type="button"
            >
              {contact.email}
              {unreadOf(contact.accountId) > 0 ? (
                <span className="badge">{unreadOf(contact.accountId)}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      {active !== null ? (
        <>
          <h3>{active.peerEmail}</h3>
          <p className="project-encryption">
            {keyedOnServer ? (
              unlocked ? (
                "Esta conversa é cifrada de ponta a ponta."
              ) : (
                "Esta conversa é cifrada. Desbloqueie a criptografia para ler e escrever."
              )
            ) : unlocked ? (
              <>
                As mensagens desta conversa ainda ficam em texto claro no
                servidor.{" "}
                <button
                  className="text-button"
                  onClick={() => void enableDm()}
                  type="button"
                >
                  Ativar criptografia nesta conversa
                </button>
              </>
            ) : (
              "Esta conversa ainda está em texto claro. Desbloqueie a criptografia para ativá-la."
            )}{" "}
            {dmStatus}
          </p>
          <ConversationView
            client={client}
            conversationId={active.id}
            crypto={dmCrypto}
            kind="dm"
            key={active.id}
            me={account.email}
            moderator={false}
          />
        </>
      ) : null}
    </section>
  );
}

export function NotificationsPanel() {
  const client = useMemo(() => createApiClient(""), []);
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  const reload = useCallback(async () => {
    try {
      setItems(await listNotifications(client));
    } catch {
      // Keep what is shown; the next event reloads.
    }
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEvents((event) => {
    if (event === "resync" || event.eventType === "notification.created") {
      void reload();
    }
  });

  const unread = items.filter((item) => !item.read).length;
  const csrf = () => readCookie(document.cookie, "oddkin_csrf");

  return (
    <div className="notifications">
      <button
        aria-expanded={open}
        className="text-button"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        Notificações{unread > 0 ? ` (${unread})` : ""}
      </button>
      {open ? (
        <div
          className="notifications__list"
          role="region"
          aria-label="Notificações"
        >
          {items.length === 0 ? (
            <p className="empty-note">Nada por aqui.</p>
          ) : null}
          <ul>
            {items.map((item) => (
              <li className={item.read ? "" : "unread"} key={item.id}>
                {NOTIFICATION_LABEL[item.kind]}{" "}
                {!item.read ? (
                  <button
                    className="text-button"
                    onClick={() => {
                      const value = csrf();
                      if (value !== null) {
                        void markNotificationRead(client, value, item.id).then(
                          reload,
                        );
                      }
                    }}
                    type="button"
                  >
                    Marcar como lida
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {unread > 0 ? (
            <button
              className="text-button"
              onClick={() => {
                const value = csrf();
                if (value !== null) {
                  void markAllNotificationsRead(client, value).then(reload);
                }
              }}
              type="button"
            >
              Marcar todas como lidas
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
