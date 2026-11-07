import {
  addMember,
  ApiStatusError,
  listOrganizationPeople,
  removeProjectMember,
  setMemberRole,
  setPersonActive,
  type CurrentAccount,
  type OrganizationPerson,
} from "@crewstead/api-client";
import { useCallback, useEffect, useState } from "react";
import { confirmDialog } from "../../design/confirm";
import { nameOf } from "../../design/people";
import { Avatar } from "../../design/primitives";
import { toast, toastError } from "../../design/toast";
import { describeError } from "../../errors";
import { useWorkspace } from "../../workspace";
import { ProjectDot } from "../ProjectDot";
import { membershipLabel } from "./settingsRules";

/** Administrators see everyone in the organization and can switch accounts off. */
export function PeopleTab({ account }: { account: CurrentAccount }) {
  const { client, projects, reload } = useWorkspace();
  const [people, setPeople] = useState<OrganizationPerson[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    listOrganizationPeople(client)
      .then(setPeople)
      .catch(() => setPeople([]));
  }, [client]);
  useEffect(load, [load]);

  async function toggle(person: OrganizationPerson) {
    if (person.active) {
      const ok = await confirmDialog({
        title: `Desativar ${nameOf(person.email)}?`,
        body: (
          <p className="muted">
            Todas as sessões terminam agora e a pessoa não consegue entrar. Os
            registros dela continuam nos projetos. Você pode reativar a conta
            depois.
          </p>
        ),
        ok: "Desativar",
        danger: true,
      });
      if (ok !== true) return;
    }
    try {
      await setPersonActive(client, person.id, !person.active);
      toast(person.active ? "Conta desativada." : "Conta reativada.", {
        icon: "check",
      });
      load();
    } catch (error) {
      toastError(
        error instanceof ApiStatusError && error.status === 409
          ? "A organização precisa de ao menos um administrador ativo."
          : "Não foi possível alterar a conta.",
      );
    }
  }

  async function addToProject(person: OrganizationPerson, projectId: string) {
    const operation = `${person.id}:${projectId}:add`;
    setBusy(operation);
    try {
      await addMember(client, projectId, person.email);
      await reload();
      toast(`${nameOf(person.email)} agora participa do projeto.`, {
        icon: "check",
      });
    } catch (error) {
      toastError(describeError(error));
    } finally {
      setBusy(null);
    }
  }

  async function removeFromProject(
    person: OrganizationPerson,
    projectId: string,
    projectName: string,
  ) {
    const ok = await confirmDialog({
      title: `Remover ${nameOf(person.email)} de ${projectName}?`,
      body: (
        <p className="muted">
          O acesso termina imediatamente. As chaves do projeto serão atualizadas
          e o histórico criado pela pessoa será preservado.
        </p>
      ),
      ok: "Remover do projeto",
      danger: true,
    });
    if (ok !== true) return;
    const operation = `${person.id}:${projectId}:remove`;
    setBusy(operation);
    try {
      await removeProjectMember(client, projectId, person.id);
      await reload();
      toast(`${nameOf(person.email)} não participa mais de ${projectName}.`, {
        icon: "check",
      });
    } catch (error) {
      toastError(
        error instanceof ApiStatusError && error.status === 409
          ? "O projeto precisa de ao menos uma pessoa gestora."
          : describeError(error),
      );
    } finally {
      setBusy(null);
    }
  }

  async function changeProjectRole(
    person: OrganizationPerson,
    projectId: string,
    makeManager: boolean,
  ) {
    const operation = `${person.id}:${projectId}:role`;
    setBusy(operation);
    try {
      await setMemberRole(client, projectId, person.id, makeManager);
      await reload();
      toast(
        makeManager
          ? "Agora é gestor do projeto."
          : "Agora é membro do projeto.",
        {
          icon: "check",
        },
      );
    } catch (error) {
      toastError(
        error instanceof ApiStatusError && error.status === 409
          ? "O projeto precisa de ao menos uma pessoa gestora."
          : describeError(error),
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card pad col gap12">
      <h2 className="h2">Pessoas da organização</h2>
      {people === null ? (
        <p className="muted">Carregando…</p>
      ) : (
        <ul className="col gap8 st-plain-list">
          {people.map((person) => {
            const open = expanded === person.id;
            const assigned = (projects ?? []).filter((state) =>
              state.members.some((member) => member.accountId === person.id),
            ).length;
            return (
              <li className="st-person" key={person.id}>
                <div className="row gap8 st-person-head">
                  <Avatar email={person.email} id={person.id} size="sm" />
                  <div className="grow col">
                    <b>{nameOf(person.email)}</b>
                    <span className="xs muted">
                      {person.email} · {membershipLabel(person)}
                    </span>
                  </div>
                  <button
                    aria-expanded={open}
                    className="btn sm ghost"
                    disabled={projects === null}
                    onClick={() => setExpanded(open ? null : person.id)}
                    type="button"
                  >
                    Projetos <span className="num">{assigned}</span>
                  </button>
                  {person.id === account.id ? null : (
                    <button
                      className="btn sm"
                      onClick={() => void toggle(person)}
                      type="button"
                    >
                      {person.active ? "Desativar" : "Reativar"}
                    </button>
                  )}
                </div>
                {open ? (
                  <div className="st-person-projects">
                    <p className="sm muted">
                      Defina em quais projetos esta pessoa participa e quem pode
                      administrar membros e configurações.
                    </p>
                    {(projects ?? []).length === 0 ? (
                      <p className="sm muted">Nenhum projeto disponível.</p>
                    ) : (
                      <ul
                        aria-label={`Projetos de ${nameOf(person.email)}`}
                        className="st-project-list"
                      >
                        {(projects ?? []).map((state) => {
                          const member = state.members.find(
                            (entry) => entry.accountId === person.id,
                          );
                          const operation = `${person.id}:${state.project.id}`;
                          const waiting =
                            busy?.startsWith(`${operation}:`) ?? false;
                          const archived = state.project.archived === true;
                          return (
                            <li
                              className="st-project-row"
                              key={state.project.id}
                            >
                              <ProjectDot color={state.project.color} />
                              <div className="grow col">
                                <b className="sm">{state.project.name}</b>
                                <span className="xs muted">
                                  {member === undefined
                                    ? "Sem acesso"
                                    : member.isManager
                                      ? "Gestor"
                                      : member.membershipKind === "external"
                                        ? "Membro externo"
                                        : "Membro"}
                                  {archived ? " · arquivado" : ""}
                                </span>
                              </div>
                              {member === undefined ? (
                                <button
                                  className="btn sm"
                                  disabled={
                                    waiting || !person.active || archived
                                  }
                                  onClick={() =>
                                    void addToProject(person, state.project.id)
                                  }
                                  type="button"
                                >
                                  {waiting ? "Adicionando…" : "Adicionar"}
                                </button>
                              ) : (
                                <>
                                  {member.membershipKind === "internal" ? (
                                    <button
                                      className="btn sm ghost"
                                      disabled={waiting || archived}
                                      onClick={() =>
                                        void changeProjectRole(
                                          person,
                                          state.project.id,
                                          !member.isManager,
                                        )
                                      }
                                      type="button"
                                    >
                                      {member.isManager
                                        ? "Tornar membro"
                                        : "Tornar gestor"}
                                    </button>
                                  ) : (
                                    <span
                                      className="tag mute"
                                      title="Perfis externos seguem as permissões compartilhadas do projeto"
                                    >
                                      Externo
                                    </span>
                                  )}
                                  {!member.isManager ? (
                                    <button
                                      className="btn sm ghost st-danger-action"
                                      disabled={waiting || archived}
                                      onClick={() =>
                                        void removeFromProject(
                                          person,
                                          state.project.id,
                                          state.project.name,
                                        )
                                      }
                                      type="button"
                                    >
                                      Remover
                                    </button>
                                  ) : null}
                                </>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {person.membershipKind === "external" ? (
                      <p className="xs muted">
                        Pessoas externas seguem o perfil de acesso compartilhado
                        do projeto e não podem ser gestoras.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
