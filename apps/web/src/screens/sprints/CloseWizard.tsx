import {
  closeSprint,
  getSprintClosePreview,
  type Sprint,
  type SprintClosePreview,
} from "@crewstead/api-client";
import { useEffect, useState } from "react";
import { showFinale } from "../../design/celebrate";
import { Icon } from "../../design/icons";
import { Modal } from "../../design/Modal";
import { blip } from "../../design/sound";
import { toastError } from "../../design/toast";
import { describeError } from "../../errors";
import { useStats } from "../../shell/stats";
import { useWorkspace } from "../../workspace";
import {
  DestinationStep,
  ReviewStep,
  SummaryStep,
  useProjectOf,
} from "./CloseWizardSteps";
import {
  closeDecisions,
  countChoice,
  initialChoices,
  isConflict,
  sprintLengthDays,
  type Choice,
} from "./sprintRules";

const STEPS = ["Resumo", "Destino das pendências", "Revisar e encerrar"];

/** Loads what closing the sprint would do and the per-item destination picks. */
function useClosePreview(sprint: Sprint, plannedCount: number) {
  const { client } = useWorkspace();
  const [preview, setPreview] = useState<SprintClosePreview | null>(null);
  const [failed, setFailed] = useState(false);
  const [choices, setChoices] = useState<Record<string, Choice>>({});

  useEffect(() => {
    let alive = true;
    getSprintClosePreview(client, sprint.id)
      .then((result) => {
        if (!alive) return;
        setPreview(result);
        setChoices(initialChoices(result.pending, plannedCount > 0));
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [client, sprint.id, plannedCount]);

  return { preview, setPreview, failed, choices, setChoices };
}

export function CloseWizard({
  sprint,
  planned,
  onClose,
}: {
  sprint: Sprint;
  planned: Sprint[];
  onClose: () => void;
}) {
  const { client } = useWorkspace();
  const { stats } = useStats();
  const projectOf = useProjectOf();
  const [step, setStep] = useState(1);
  const { preview, setPreview, failed, choices, setChoices } = useClosePreview(
    sprint,
    planned.length,
  );
  const [destination, setDestination] = useState(planned[0]?.id ?? "");
  const [conflict, setConflict] = useState("");
  const [busy, setBusy] = useState(false);

  const needsNext = Object.values(choices).includes("next");
  const pending = preview?.pending ?? [];
  const nextName =
    planned.find((entry) => entry.id === destination)?.name ?? "";

  async function confirm() {
    if (preview === null) return;
    setBusy(true);
    try {
      await closeSprint(
        client,
        sprint.id,
        closeDecisions(preview.pending, choices),
        needsNext ? destination : undefined,
      );
      const carried = countChoice(choices, "next");
      onClose();
      showFinale({
        name: sprint.name,
        goal: sprint.goal,
        delivered: preview.completed.length,
        carried: pending.length === 0 ? 0 : carried,
        urgent: preview.completed.filter((item) => item.priority === "urgent")
          .length,
        days: sprintLengthDays(sprint.startsOn, sprint.endsOn),
        projects: [
          ...new Set(
            preview.completed
              .map((item) => projectOf(item)?.project.name)
              .filter((value): value is string => value !== undefined),
          ),
        ],
        streak: stats?.currentStreak ?? 0,
      });
    } catch (error) {
      setBusy(false);
      if (isConflict(error)) {
        setConflict("Alguém alterou uma pendência durante a revisão.");
        blip("err");
        setStep(2);
        getSprintClosePreview(client, sprint.id)
          .then(setPreview)
          .catch(() => undefined);
      } else {
        toastError(describeError(error));
      }
    }
  }

  return (
    <Modal label={`Encerrar ${sprint.name}`} onClose={onClose} width="760px">
      <div className="dh">
        <div className="row gap16 wrap">
          {STEPS.map((label, index) => (
            <span
              className={`wiz-step${index + 1 === step ? " on" : index + 1 < step ? " ok" : ""}`}
              key={label}
            >
              <b>
                {index + 1 < step ? <Icon name="check" size="sm" /> : index + 1}
              </b>
              {label}
            </span>
          ))}
        </div>
      </div>
      <div className="dbd sp-wiz-body">
        {failed ? (
          <p className="muted">Não foi possível carregar o resumo.</p>
        ) : null}
        {preview === null && !failed ? (
          <p className="muted">Carregando resumo…</p>
        ) : null}
        {preview !== null && step === 1 ? (
          <SummaryStep preview={preview} />
        ) : null}
        {preview !== null && step === 2 ? (
          <DestinationStep
            choices={choices}
            conflict={conflict}
            destination={destination}
            onChoice={(itemId, choice) =>
              setChoices((value) => ({ ...value, [itemId]: choice }))
            }
            onDestination={setDestination}
            planned={planned}
            preview={preview}
          />
        ) : null}
        {preview !== null && step === 3 ? (
          <ReviewStep
            choices={choices}
            nextName={nextName}
            pendingCount={pending.length}
          />
        ) : null}
      </div>
      <div className="dft">
        {step > 1 ? (
          <button
            className="btn"
            onClick={() => setStep(step - 1)}
            type="button"
          >
            Voltar
          </button>
        ) : (
          <button className="btn" onClick={onClose} type="button">
            Cancelar
          </button>
        )}
        {step < 3 ? (
          <button
            className="btn primary"
            disabled={preview === null || (step === 1 && preview.blocked)}
            onClick={() => setStep(step + 1)}
            type="button"
          >
            Continuar
          </button>
        ) : (
          <button
            className={`btn accent${busy ? " loading" : ""}`}
            disabled={preview === null || preview.blocked}
            onClick={() => void confirm()}
            type="button"
          >
            Encerrar sprint
          </button>
        )}
      </div>
    </Modal>
  );
}
