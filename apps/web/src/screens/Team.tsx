import {
  listInvitations,
  type CurrentAccount,
  type InvitationStatus,
} from "@crewstead/api-client";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "../design/icons";
import { Page } from "../shell/Page";
import { useReloadOn } from "../events";
import { useWorkspace } from "../workspace";
import { EditProjectDialog } from "./team/EditProjectDialog";
import { ExternalPolicyCard } from "./team/ExternalPolicyCard";
import { InvitationsCard } from "./team/InvitationsCard";
import { InviteDialog } from "./team/InviteDialog";
import { InvitePolicyCard } from "./team/InvitePolicyCard";
import { MembersCard } from "./team/MembersCard";
import { canInviteToProject } from "./team/teamRules";
import { ProjectDot } from "./ProjectDot";

const INVITATION_EVENTS = ["invitation.changed"];

export function Team({ account }: { account: CurrentAccount }) {
  const { projects, current, setCurrentProjectId, client } = useWorkspace();
  const [invite, setInvite] = useState(false);
  const [editing, setEditing] = useState(false);
  const manager = current?.project.isManager === true || account.isAdmin;
  const invitePolicy = current?.project.invitePolicy ?? "admins";
  const canInvite =
    current !== null &&
    canInviteToProject(account, {
      isManager: current.project.isManager,
      policy: invitePolicy,
    });
  const projectId = current?.project.id;
  const [invitations, setInvitations] = useState<InvitationStatus[] | null>(
    null,
  );
  const sees = account.isAdmin || current?.project.isManager === true;
  const loadInvitations = useCallback(() => {
    if (!sees) return;
    listInvitations(client, account.isAdmin ? undefined : projectId)
      .then(setInvitations)
      .catch(() => setInvitations([]));
  }, [client, account.isAdmin, sees, projectId]);
  useEffect(loadInvitations, [loadInvitations]);
  // Someone accepting shows up here without reloading.
  useReloadOn(INVITATION_EVENTS, loadInvitations);

  return (
    <Page
      cta={
        manager || canInvite ? (
          <>
            {current?.project.isManager ? (
              <button
                className="btn"
                onClick={() => setEditing(true)}
                type="button"
              >
                <Icon name="edit" size="sm" /> Editar projeto
              </button>
            ) : null}
            {canInvite ? (
              <button
                className="btn primary"
                onClick={() => setInvite(true)}
                type="button"
              >
                <Icon name="plus" /> Convidar
              </button>
            ) : null}
          </>
        ) : null
      }
      sub="Membros, convites e o perfil comum de permissões dos externos."
      title="Equipe do projeto"
    >
      <div aria-label="Projeto" className="pill-tabs tm-mb18" role="group">
        {(projects ?? []).map((state) => (
          <button
            aria-pressed={state.project.id === current?.project.id}
            className="pill"
            key={state.project.id}
            onClick={() => setCurrentProjectId(state.project.id)}
            type="button"
          >
            <ProjectDot color={state.project.color} />
            {state.project.name}
          </button>
        ))}
      </div>
      {current === null ? (
        <p className="muted">Nenhum projeto acessível ainda.</p>
      ) : (
        <div className="grid2">
          <div className="stack">
            <MembersCard
              account={account}
              current={current}
              manager={manager}
            />
            {current.project.isManager ? (
              <InvitePolicyCard current={current} invitePolicy={invitePolicy} />
            ) : null}
            {sees && invitations !== null && invitations.length > 0 ? (
              <InvitationsCard invitations={invitations} />
            ) : null}
          </div>
          <ExternalPolicyCard current={current} />
        </div>
      )}
      {editing && current !== null ? (
        <EditProjectDialog onClose={() => setEditing(false)} state={current} />
      ) : null}
      {invite && current !== null ? (
        <InviteDialog
          onClose={() => setInvite(false)}
          onInvited={loadInvitations}
          projectId={current.project.id}
        />
      ) : null}
    </Page>
  );
}
