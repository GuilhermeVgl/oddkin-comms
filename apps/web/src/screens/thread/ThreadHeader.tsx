import type { ProjectMember } from "@crewstead/api-client";
import { Icon } from "../../design/icons";
import { Avatar } from "../../design/primitives";
import type { ThreadTarget } from "./types";
import type { ActiveCall } from "./useCallBanner";

/** Back button, title, who is in it, search, files toggle and the call button. */
export function ThreadHeader({
  target,
  me,
  members,
  query,
  onQuery,
  files,
  onToggleFiles,
  call,
  canCall,
  onCall,
  onBack,
}: {
  target: ThreadTarget;
  me: { id: string; email: string };
  members: ProjectMember[];
  query: string;
  onQuery: (value: string) => void;
  files: boolean;
  onToggleFiles: () => void;
  call: ActiveCall | null;
  canCall: boolean;
  onCall: () => void;
  onBack: () => void;
}) {
  return (
    <div className="th-h">
      <button
        aria-label="Voltar às conversas"
        className="iconbtn backbtn"
        onClick={onBack}
        type="button"
      >
        <Icon name="left" />
      </button>
      <div className="grow col">
        <h2>{target.title}</h2>
        <span className="xs muted">{target.subtitle}</span>
      </div>
      <span className="avs">
        {target.kind === "chat"
          ? members
              .slice(0, 5)
              .map((member) => (
                <Avatar
                  email={member.email}
                  id={member.accountId}
                  key={member.accountId}
                  size="sm"
                />
              ))
          : [
              <Avatar email={me.email} id={me.id} key="me" size="sm" />,
              <Avatar
                email={target.peerEmail}
                id={target.peerId}
                key="peer"
                size="sm"
              />,
            ]}
      </span>
      <div className="field th-search">
        <input
          aria-label="Buscar nesta conversa"
          className="inp"
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Buscar nesta conversa"
          type="search"
          value={query}
        />
      </div>
      <button
        aria-pressed={files}
        className="btn sm"
        onClick={onToggleFiles}
        type="button"
      >
        <Icon name="clip" size="sm" />
        Arquivos
      </button>
      <button
        className="btn sm"
        disabled={!canCall}
        onClick={onCall}
        title={
          canCall
            ? undefined
            : "Seu perfil neste projeto não permite iniciar chamadas"
        }
        type="button"
      >
        <Icon name="video" size="sm" />
        {call === null
          ? "Iniciar chamada"
          : `Entrar na chamada (${call.count}/${call.max})`}
      </button>
    </div>
  );
}
