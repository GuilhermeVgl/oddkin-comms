import {
  ApiStatusError,
  listOrganizationPeople,
  setPersonActive,
  type CurrentAccount,
  type OrganizationPerson,
} from "@crewstead/api-client";
import { useCallback, useEffect, useState } from "react";
import { confirmDialog } from "../../design/confirm";
import { nameOf } from "../../design/people";
import { Avatar } from "../../design/primitives";
import { toast, toastError } from "../../design/toast";
import { useWorkspace } from "../../workspace";
import { membershipLabel } from "./settingsRules";

/** Administrators see everyone in the organization and can switch accounts off. */
export function PeopleTab({ account }: { account: CurrentAccount }) {
  const { client } = useWorkspace();
  const [people, setPeople] = useState<OrganizationPerson[] | null>(null);
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

  return (
    <section className="card pad col gap12">
      <h2 className="h2">Pessoas da organização</h2>
      {people === null ? (
        <p className="muted">Carregando…</p>
      ) : (
        <ul className="col gap8 st-plain-list">
          {people.map((person) => (
            <li className="row gap8" key={person.id}>
              <Avatar email={person.email} id={person.id} size="sm" />
              <div className="grow col">
                <b>{nameOf(person.email)}</b>
                <span className="xs muted">
                  {person.email} · {membershipLabel(person)}
                </span>
              </div>
              {person.id === account.id ? null : (
                <button
                  className="btn sm"
                  onClick={() => void toggle(person)}
                  type="button"
                >
                  {person.active ? "Desativar" : "Reativar"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
