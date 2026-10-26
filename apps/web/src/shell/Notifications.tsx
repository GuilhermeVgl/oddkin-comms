import type { Notification } from "@crewstead/api-client";
import { Icon, type IconName } from "../design/icons";
import { Menu } from "../design/Menu";
import { rel } from "../design/format";
import { Sprite } from "../design/Sprite";
import { useInbox } from "../inbox";
import { go } from "../design/router";
import { useWorkspace } from "../workspace";
import { useCalls } from "./calls";

const LABEL: Record<Notification["kind"], string> = {
  mention: "Você foi mencionado",
  assignment: "Uma atividade foi atribuída a você",
  call_invite: "Você foi chamado para uma conversa por voz e vídeo",
  recovery_access: "A administração restaurou seu acesso ao histórico cifrado",
  followed_update: "Uma atividade que você segue foi atualizada",
  direct_message: "Nova mensagem direta",
};

const ICON: Record<Notification["kind"], IconName> = {
  mention: "at",
  assignment: "board",
  call_invite: "video",
  recovery_access: "key",
  followed_update: "eye",
  direct_message: "chat",
};

export function NotificationsMenu({
  anchor,
  onClose,
}: {
  anchor: HTMLElement;
  onClose: () => void;
}) {
  const {
    notifications,
    unreadNotifications,
    markNotification,
    markAllNotifications,
  } = useInbox();
  const { invitations, openCall, decline } = useCalls();
  const { setCurrentProjectId } = useWorkspace();

  function openTarget(item: Notification) {
    if (item.projectId !== undefined) setCurrentProjectId(item.projectId);
    switch (item.kind) {
      case "assignment":
      case "followed_update":
        go(`work/${item.resourceId}`);
        break;
      case "mention":
        go(
          item.conversationId === undefined
            ? `work/${item.resourceId}`
            : `chat/${item.conversationId}`,
        );
        break;
      case "direct_message":
        go(
          item.conversationId === undefined
            ? "chat"
            : `chat/${item.conversationId}`,
        );
        break;
      case "recovery_access":
        go("settings/dispositivos");
        break;
      case "call_invite":
        break;
    }
  }

  return (
    <Menu
      anchor={anchor}
      className="notifs"
      focusFirst={false}
      onClose={onClose}
      right
    >
      <div className="nh">
        <span className="grow">
          Notificações{" "}
          {unreadNotifications > 0 ? (
            <span className="tag lime num">{unreadNotifications}</span>
          ) : null}
        </span>
        <button
          className="btn sm ghost"
          onClick={() => {
            void markAllNotifications();
            onClose();
          }}
          type="button"
        >
          Marcar todas como lidas
        </button>
      </div>
      {notifications.length === 0 ? (
        <div className="empty" style={{ padding: 28 }}>
          <div className="emp-sp">
            <Sprite pose="sleep" scale={3} who="tela" />
          </div>
          <h3>Tudo em dia</h3>
          <p>Sem notificações novas.</p>
        </div>
      ) : null}
      {notifications.map((item) => {
        const invite =
          item.kind === "call_invite"
            ? invitations.find((entry) => entry.callId === item.resourceId)
            : undefined;
        return (
          <div className="menuish" key={item.id}>
            <button
              className={`ni${item.read ? "" : " unr"}`}
              onClick={() => {
                void markNotification(item.id);
                onClose();
                openTarget(item);
              }}
              type="button"
            >
              <span
                className="av lg"
                style={{
                  background: "var(--brand-tint)",
                  color: "var(--brand-ink)",
                }}
              >
                <Icon name={ICON[item.kind]} size="sm" />
              </span>
              <span className="grow col">
                <span className="tx">{LABEL[item.kind]}</span>
                <time>{rel(item.createdAt)}</time>
                {invite === undefined ? null : (
                  <span className="row" style={{ marginTop: 6 }}>
                    <span
                      className="btn sm primary"
                      onClick={(event) => {
                        event.stopPropagation();
                        void markNotification(item.id);
                        onClose();
                        openCall(invite.callId);
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      Entrar
                    </span>
                    <span
                      className="btn sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        void markNotification(item.id);
                        onClose();
                        void decline(invite.callId);
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      Recusar
                    </span>
                  </span>
                )}
              </span>
            </button>
          </div>
        );
      })}
    </Menu>
  );
}
