import {
  ApiStatusError,
  removeProjectMember,
  setMemberRole,
  type CurrentAccount,
} from "@crewstead/api-client";
import { confirmDialog } from "../../design/confirm";
import { nameOf } from "../../design/people";
import { Avatar } from "../../design/primitives";
import { toast, toastError } from "../../design/toast";
import { csrfToken, describeError } from "../../errors";
import { useWorkspace, type ProjectState } from "../../workspace";
import { memberRoleLabel } from "./teamRules";

export function MembersCard({
  account,
  current,
  manager,
}: {
  account: CurrentAccount;
  current: ProjectState;
  manager: boolean;
}) {
  const { client, reload } = useWorkspace();

  async function remove(accountId: string, email: string) {
    const ok = await confirmDialog({
      title: `Remover ${nameOf(email)} do projeto?`,
      body: (
        <p className="muted">
          O acesso é bloqueado e as conexões abertas são encerradas na hora.
          Cópias que a pessoa já tem não podem ser apagadas à distância. As
          chaves do projeto serão rotacionadas e as atividades dela ficam sem
          responsável.
        </p>
      ),
      ok: "Remover",
      danger: true,
    });
    if (ok !== true) return;
    try {
      await removeProjectMember(
        client,
        csrfToken(),
        current.project.id,
        accountId,
      );
      toast(
        `${nameOf(email)} removida. Mídia e escritas futuras usam nova chave.`,
        { icon: "lock" },
      );
      await reload();
    } catch (error) {
      toastError(
        error instanceof ApiStatusError && error.status === 409
          ? "O projeto precisa de ao menos uma pessoa gestora."
          : describeError(error),
      );
    }
  }

  async function changeRole(accountId: string, makeManager: boolean) {
    try {
      await setMemberRole(
        client,
        csrfToken(),
        current.project.id,
        accountId,
        makeManager,
      );
      toast(makeManager ? "Agora é gestor." : "Deixou de ser gestor.", {
        icon: "check",
      });
      await reload();
    } catch (error) {
      toastError(
        error instanceof ApiStatusError && error.status === 409
          ? "O projeto precisa de ao menos um gestor."
          : describeError(error),
      );
    }
  }

  return (
    <section className="card pad">
      <h2 className="h2 tm-h2-tight">
        Membros <span className="tag mute num">{current.members.length}</span>
      </h2>
      {current.members.map((member) => (
        <div className="list-i" key={member.accountId}>
          <Avatar email={member.email} id={member.accountId} size="lg" />
          <div className="grow col">
            <b>
              {nameOf(member.email)}
              {member.membershipKind === "external" ? (
                <span className="ext">externo</span>
              ) : null}
            </b>
            <span className="xs muted">
              {memberRoleLabel(member)}
              {" · "}
              {member.email}
            </span>
          </div>
          {current.project.isManager && member.membershipKind === "internal" ? (
            <button
              className="btn sm ghost"
              onClick={() =>
                void changeRole(member.accountId, !member.isManager)
              }
              type="button"
            >
              {member.isManager ? "Tirar de gestor" : "Tornar gestor"}
            </button>
          ) : null}
          {manager && member.accountId !== account.id && !member.isManager ? (
            <button
              className="btn sm ghost"
              onClick={() => void remove(member.accountId, member.email)}
              type="button"
            >
              Remover
            </button>
          ) : null}
        </div>
      ))}
    </section>
  );
}
