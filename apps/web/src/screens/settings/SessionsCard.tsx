import {
  listSessions,
  revokeSession,
  type AuthSession,
} from "@crewstead/api-client";
import { useCallback, useEffect, useState } from "react";
import { rel } from "../../design/format";
import { toast, toastError } from "../../design/toast";
import { useWorkspace } from "../../workspace";

export function SessionsCard({ onLogout }: { onLogout: () => void }) {
  const { client } = useWorkspace();
  const [sessions, setSessions] = useState<AuthSession[] | null>(null);
  const load = useCallback(() => {
    listSessions(client)
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [client]);
  useEffect(load, [load]);

  return (
    <section className="card pad col gap12">
      <h2 className="h2">Sessões abertas</h2>
      {sessions === null ? (
        <p className="muted">Carregando…</p>
      ) : (
        <ul className="col gap8 st-plain-list">
          {sessions.map((entry) => (
            <li className="row gap8" key={entry.id}>
              <div className="grow col">
                <b>{entry.current ? "Esta sessão" : "Outra sessão"}</b>
                <span className="xs muted">
                  Iniciada {rel(entry.createdAt)} · ativa{" "}
                  {rel(entry.lastSeenAt)}
                </span>
              </div>
              <button
                className="btn sm"
                onClick={() => {
                  revokeSession(client, entry.id)
                    .then(() => {
                      if (entry.current) onLogout();
                      else {
                        toast("Sessão encerrada.", { icon: "check" });
                        load();
                      }
                    })
                    .catch(() => toastError("Não foi possível encerrar."));
                }}
                type="button"
              >
                {entry.current ? "Sair" : "Encerrar"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
