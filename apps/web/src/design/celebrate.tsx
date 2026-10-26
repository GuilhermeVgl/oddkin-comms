import { useEffect, useRef, useSyncExternalStore } from "react";
import { Duo, type DuoRef } from "./Sprite";
import { blip } from "./sound";
import { burst } from "./sprites";
import { recapText, streakLabel, type SprintRecap } from "./gamify";
import { toast } from "./toast";
import { getDuoVisible, useDuoVisible } from "./duoVisibility";

const LINES = [
  "Bom trabalho, dupla.",
  "Mais um passo. Sem pressa.",
  "Entregue. Respira.",
  "Isso aí. Próximo.",
  "Pequenos passos, grandes entregas.",
];

const BIG_LINES = [
  "Entrega pesada! Merece respirar.",
  "Isso era grande. E foi.",
  "Peso pesado entregue. Palmas.",
];

/**
 * A short celebration for a finished activity: a burst of pixels where the card
 * was, a small win jingle (when sound is on) and a line from Capuz.
 * With reduced motion only the line remains.
 */
export function celebrate(anchor: Element | null, big = false) {
  const rect = anchor?.getBoundingClientRect();
  const x =
    rect === undefined ? window.innerWidth / 2 : rect.left + rect.width / 2;
  const y =
    rect === undefined ? window.innerHeight / 2 : rect.top + rect.height / 2;
  burst(x, y, { count: big ? 70 : 34, power: big ? 10 : 7 });
  if (big)
    window.setTimeout(
      () => burst(x, y - 30, { count: 40, power: 12, up: true }),
      220,
    );
  blip("win");
  const lines = big ? BIG_LINES : LINES;
  const line = lines[Math.floor(Math.random() * lines.length)] ?? "";
  toast(line, {
    ...(getDuoVisible()
      ? {
          mascot: "capuz" as const,
          pose: big ? ("highfive" as const) : ("cheer" as const),
        }
      : { icon: "check" as const }),
    ms: big ? 3600 : 2600,
  });
}

type Finale = SprintRecap;

let finale: Finale | null = null;
const listeners = new Set<() => void>();

function set(next: Finale | null) {
  finale = next;
  listeners.forEach((listener) => listener());
}

/** The full-screen moment when a sprint closes. */
export function showFinale(value: Finale) {
  set(value);
}

export function FinaleHost() {
  const showDuo = useDuoVisible();
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => finale,
  );
  const duo = useRef<DuoRef>(null);
  const ok = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (current === null) return;
    ok.current?.focus();
    const first = window.setTimeout(() => {
      burst(window.innerWidth / 2, window.innerHeight / 2 - 40, {
        count: 90,
        power: 12,
        up: true,
      });
      blip("win");
    }, 150);
    const second = window.setTimeout(() => duo.current?.set("highfive"), 1500);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(second);
    };
  }, [current]);

  if (current === null) return null;
  const { name, delivered, carried, urgent, days, streak, goal } = current;
  return (
    <div
      aria-label="Sprint encerrada"
      className="celebrate"
      onKeyDown={(event) => {
        if (event.key === "Escape") set(null);
      }}
      role="dialog"
    >
      <div className="box">
        <div className="px" style={{ color: "var(--limao)" }}>
          {name}
        </div>
        <h2>Sprint encerrada</h2>
        {showDuo ? (
          <div
            className="stage-px"
            style={{ display: "flex", gap: 20, alignItems: "flex-end" }}
          >
            <Duo gap={10} pose="cheer" ref={duo} scale={6} />
          </div>
        ) : null}
        <div className="pdlg" style={{ fontSize: 20 }}>
          {delivered} {delivered === 1 ? "entrega" : "entregas"}. {carried}{" "}
          {carried === 1 ? "pendência seguiu" : "pendências seguiram"} com
          destino. <b>Bom trabalho.</b>
        </div>
        {goal === "" ? null : (
          <div className="pdlg" style={{ fontSize: 16 }}>
            Missão: {goal}
          </div>
        )}
        <div className="row gap8 wrap" style={{ justifyContent: "center" }}>
          <span className="tag lime">
            {days} {days === 1 ? "dia" : "dias"} de sprint
          </span>
          {urgent > 0 ? (
            <span className="tag lime">
              {urgent} {urgent === 1 ? "urgente" : "urgentes"} entregue
              {urgent === 1 ? "" : "s"}
            </span>
          ) : null}
          {streak > 1 ? (
            <span className="tag lime">{streakLabel(streak)}</span>
          ) : null}
        </div>
        <div className="row gap8">
          <button
            className="btn lg"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(recapText(current))
                .then(() =>
                  toast("Resumo copiado. Cole no canal da equipe.", {
                    icon: "link",
                  }),
                )
                .catch(() =>
                  toast("Não foi possível copiar o resumo.", { kind: "err" }),
                );
            }}
            type="button"
          >
            Copiar resumo
          </button>
          <button
            className="btn accent lg"
            onClick={() => set(null)}
            ref={ok}
            type="button"
          >
            Continuar
          </button>
        </div>
      </div>
    </div>
  );
}
