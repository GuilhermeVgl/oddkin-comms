import { useEffect, useRef, useSyncExternalStore } from "react";
import { Duo, type DuoRef } from "./Sprite";
import { blip } from "./sound";
import { burst } from "./sprites";
import { toast } from "./toast";
import { getDuoVisible, useDuoVisible } from "./duoVisibility";

const LINES = [
  "Bom trabalho, dupla.",
  "Mais um passo. Sem pressa.",
  "Entregue. Respira.",
  "Isso aí. Próximo.",
  "Pequenos passos, grandes entregas.",
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
  blip("win");
  if (!big) {
    toast(LINES[Math.floor(Math.random() * LINES.length)] ?? LINES[0] ?? "", {
      ...(getDuoVisible()
        ? { mascot: "capuz" as const, pose: "cheer" as const }
        : { icon: "check" as const }),
      ms: 2600,
    });
  }
}

type Finale = { name: string; delivered: number; carried: number };

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
  const { name, delivered, carried } = current;
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
  );
}
