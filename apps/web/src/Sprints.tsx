import {
  ApiStatusError,
  closeSprint,
  createApiClient,
  getSprintKeyDomain,
  getSprintClosePreview,
  listSprints,
  listSprintWorkItems,
  readCookie,
  startSprint,
  type CurrentAccount,
  type Sprint,
  type SprintClosePreview,
  type WorkItem,
} from "@oddkin/api-client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useOptionalE2EE } from "./e2ee/E2EE";
import {
  createSprintContent,
  decryptSprints,
  encryptSprint,
} from "./e2ee/content";
import type { ProjectCrypto } from "./e2ee/projectCrypto";
import { useEvents } from "./events";

const STATE_LABEL: Record<string, string> = {
  planned: "Planejada",
  active: "Ativa",
  closed: "Encerrada",
};

function csrfToken(): string {
  const token = readCookie(document.cookie, "oddkin_csrf");
  if (token === null) throw new Error("missing csrf cookie");
  return token;
}

export function SprintsArea({ account }: { account: CurrentAccount }) {
  const client = useMemo(() => createApiClient(""), []);
  const [sprints, setSprints] = useState<Sprint[] | null>(null);
  const [items, setItems] = useState<Record<string, WorkItem[]>>({});
  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [message, setMessage] = useState("");
  const [closing, setClosing] = useState<Sprint | null>(null);
  const e2ee = useOptionalE2EE();
  const unlocked = e2ee?.phase === "unlocked";
  const [sprintCrypto, setSprintCrypto] = useState<ProjectCrypto | null>(null);
  const [keyed, setKeyed] = useState(false);

  const reload = useCallback(async () => {
    try {
      const domain = await getSprintKeyDomain(client).catch(() => null);
      setKeyed((domain?.currentGeneration ?? 0) > 0);
      const opened =
        unlocked && e2ee !== null
          ? await e2ee.openOrganization({ maintain: true }).catch(() => null)
          : null;
      setSprintCrypto(opened);
      const list = await decryptSprints(opened, await listSprints(client));
      setSprints(list);
      const entries = await Promise.all(
        list
          .filter((sprint) => sprint.state !== "closed")
          .map(
            async (sprint) =>
              [
                sprint.id,
                await listSprintWorkItems(client, sprint.id),
              ] as const,
          ),
      );
      setItems(Object.fromEntries(entries));
    } catch {
      setSprints([]);
      setMessage("Não foi possível carregar as sprints.");
    }
  }, [client, unlocked, e2ee]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEvents((event) => {
    if (
      event === "resync" ||
      event.eventType === "sprint.changed" ||
      event.eventType === "key-domain.changed"
    ) {
      void reload();
    }
  });

  async function enableSprintEncryption() {
    if (sprintCrypto === null || sprints === null) return;
    await act(async () => {
      await sprintCrypto.enable(csrfToken);
      for (const sprint of sprints) {
        if (!sprint.encrypted)
          await encryptSprint(client, csrfToken(), sprintCrypto, sprint);
      }
    });
  }

  async function act(action: () => Promise<unknown>) {
    try {
      await action();
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof ApiStatusError && error.status === 409
          ? "Já existe uma sprint ativa ou o estado mudou. Recarregamos."
          : "Não foi possível concluir a ação.",
      );
    }
    await reload();
  }

  return (
    <section className="sprints" aria-labelledby="sprints-title">
      <h2 id="sprints-title">Sprints da equipe</h2>
      <p aria-live="polite" className="form-message">
        {message}
      </p>
      {sprints === null ? <p>Carregando sprints…</p> : null}
      {sprints !== null && sprints.length === 0 ? (
        <p className="empty-note">Nenhuma sprint planejada.</p>
      ) : null}
      <ul className="sprint-list">
        {(sprints ?? []).map((sprint) => (
          <li key={sprint.id}>
            <strong>{sprint.name}</strong>{" "}
            <span>
              {STATE_LABEL[sprint.state]} · {sprint.startsOn} a {sprint.endsOn}
            </span>
            {sprint.goal !== "" ? <p>{sprint.goal}</p> : null}
            {sprint.state !== "closed" ? (
              <p className="card__meta">
                {(items[sprint.id] ?? []).length} atividades acessíveis
              </p>
            ) : null}
            {account.isAdmin && sprint.state === "planned" ? (
              <button
                className="text-button"
                onClick={() =>
                  void act(() => startSprint(client, csrfToken(), sprint.id))
                }
                type="button"
              >
                Iniciar
              </button>
            ) : null}
            {account.isAdmin && sprint.state === "active" ? (
              <button
                className="text-button"
                onClick={() => setClosing(sprint)}
                type="button"
              >
                Encerrar…
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {account.isAdmin && unlocked && !keyed ? (
        <p className="project-encryption">
          Nomes e objetivos das sprints ainda ficam em texto claro.{" "}
          <button
            className="text-button"
            onClick={() => void enableSprintEncryption()}
            type="button"
          >
            Cifrar nomes de sprints
          </button>
        </p>
      ) : null}
      {keyed && !unlocked ? (
        <p className="form-message">
          Desbloqueie a criptografia para ver os nomes das sprints.
        </p>
      ) : null}
      {account.isAdmin ? (
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              await createSprintContent(client, csrfToken(), sprintCrypto, {
                name,
                startsOn,
                endsOn,
              });
              setName("");
            });
          }}
        >
          <label className="visually-hidden" htmlFor="sprint-name">
            Nome da sprint
          </label>
          <input
            id="sprint-name"
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nova sprint"
            required
            value={name}
          />
          <label className="visually-hidden" htmlFor="sprint-start">
            Início
          </label>
          <input
            id="sprint-start"
            onChange={(event) => setStartsOn(event.target.value)}
            required
            type="date"
            value={startsOn}
          />
          <label className="visually-hidden" htmlFor="sprint-end">
            Fim
          </label>
          <input
            id="sprint-end"
            min={startsOn}
            onChange={(event) => setEndsOn(event.target.value)}
            required
            type="date"
            value={endsOn}
          />
          <button type="submit">Planejar</button>
        </form>
      ) : null}
      {closing !== null ? (
        <CloseDialog
          client={client}
          onDone={() => {
            setClosing(null);
            void reload();
          }}
          planned={(sprints ?? []).filter((s) => s.state === "planned")}
          sprint={closing}
        />
      ) : null}
    </section>
  );
}

function CloseDialog({
  client,
  sprint,
  planned,
  onDone,
}: {
  client: ReturnType<typeof createApiClient>;
  sprint: Sprint;
  planned: Sprint[];
  onDone: () => void;
}) {
  const [preview, setPreview] = useState<SprintClosePreview | null>(null);
  const [choices, setChoices] = useState<Record<string, "next" | "backlog">>(
    {},
  );
  const [destination, setDestination] = useState(planned[0]?.id ?? "");
  const [error, setError] = useState("");

  useEffect(() => {
    getSprintClosePreview(client, sprint.id)
      .then((result) => {
        setPreview(result);
        setChoices(
          Object.fromEntries(
            result.pending.map((item) => [
              item.id,
              planned.length > 0 ? "next" : "backlog",
            ]),
          ),
        );
      })
      .catch(() => setError("Não foi possível carregar o resumo."));
  }, [client, sprint.id, planned.length]);

  if (preview === null) return <p>{error || "Carregando resumo…"}</p>;
  const needsNext = Object.values(choices).includes("next");

  return (
    <div
      className="detail"
      role="dialog"
      aria-label={`Encerrar ${sprint.name}`}
    >
      <h3>Encerrar {sprint.name}</h3>
      <p>{preview.completed.length} concluídas.</p>
      {preview.blocked ? (
        <p className="form-message">
          Há pendências em projetos aos quais você não tem acesso. Peça acesso
          antes de encerrar.
        </p>
      ) : null}
      {preview.pending.length === 0 ? (
        <p className="empty-note">Sem pendências.</p>
      ) : null}
      <ul className="subtasks">
        {preview.pending.map((item) => (
          <li key={item.id}>
            {item.title}{" "}
            <select
              aria-label={`Destino de ${item.title}`}
              onChange={(event) =>
                setChoices((current) => ({
                  ...current,
                  [item.id]: event.target.value as "next" | "backlog",
                }))
              }
              value={choices[item.id] ?? "backlog"}
            >
              <option disabled={planned.length === 0} value="next">
                Próxima sprint
              </option>
              <option value="backlog">Backlog</option>
            </select>
          </li>
        ))}
      </ul>
      {needsNext ? (
        <>
          <label htmlFor="sprint-destination">Sprint de destino</label>
          <select
            id="sprint-destination"
            onChange={(event) => setDestination(event.target.value)}
            value={destination}
          >
            {planned.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </>
      ) : null}
      <p aria-live="polite" className="form-message">
        {error}
      </p>
      <div className="inline-form">
        <button
          disabled={preview.blocked}
          onClick={() =>
            void closeSprint(
              client,
              csrfToken(),
              sprint.id,
              preview.pending.map((item) => ({
                workItemId: item.id,
                version: item.version,
                destination: choices[item.id] ?? "backlog",
              })),
              needsNext ? destination : undefined,
            )
              .then(onDone)
              .catch(() =>
                setError(
                  "Alguém alterou uma pendência. Reabra o resumo e revise.",
                ),
              )
          }
          type="button"
        >
          Confirmar encerramento
        </button>
        <button className="text-button" onClick={onDone} type="button">
          Cancelar
        </button>
      </div>
    </div>
  );
}
