import type { CurrentAccount } from "@crewstead/api-client";
import { useEffect, useMemo } from "react";
import { go } from "../design/router";
import { Sprite } from "../design/Sprite";
import { useInbox } from "../inbox";
import { useWorkspace } from "../workspace";
import { Thread, type ThreadTarget } from "./Thread";
import { threadTargetFor } from "./thread/target";

/** The selected conversation content; the persistent list lives in the shell. */
export function Chat({
  account,
  conversationId,
}: {
  account: CurrentAccount;
  conversationId: string | null;
}) {
  const { projects, current, setCurrentProjectId } = useWorkspace();
  const { channels, dms } = useInbox();
  const everyId = useMemo(
    () =>
      new Set([
        ...channels.map((entry) => entry.id),
        ...dms.map((entry) => entry.id),
      ]),
    [channels, dms],
  );
  const selectedId =
    conversationId !== null && everyId.has(conversationId)
      ? conversationId
      : (channels.find((entry) => entry.projectId === current?.project.id)
          ?.id ??
        channels[0]?.id ??
        dms[0]?.id ??
        null);
  const channel = channels.find((entry) => entry.id === selectedId);
  useEffect(() => {
    if (channel !== undefined && channel.projectId !== current?.project.id)
      setCurrentProjectId(channel.projectId);
  }, [channel, current, setCurrentProjectId]);
  const target: ThreadTarget | null = useMemo(
    () =>
      selectedId === null
        ? null
        : threadTargetFor(selectedId, { channels, dms, projects }),
    [selectedId, channels, dms, projects],
  );

  if (target === null) {
    return (
      <div className="chat-empty empty">
        <div className="emp-sp">
          <Sprite pose="sleep" scale={4} who="capuz" />
        </div>
        <h3>Sem conversas</h3>
        <p>Seus canais e mensagens diretas aparecerão na coluna ao lado.</p>
      </div>
    );
  }
  return (
    <div className="chat-content">
      <Thread
        key={target.id}
        me={{ id: account.id, email: account.email }}
        onBack={() => go("chat")}
        target={target}
      />
    </div>
  );
}
