import { recordFocusSession } from "@crewstead/api-client";
import { useCallback, useEffect, useRef } from "react";
import {
  MIN_COUNTED_FOCUS,
  clockLabel,
  elapsedMinutes,
} from "../design/gamify";
import { createStore } from "../design/store";
import { blip } from "../design/sound";
import { burst } from "../design/sprites";
import { Sprite } from "../design/Sprite";
import { toast } from "../design/toast";
import { useWorkspace } from "../workspace";
import { useStats } from "./stats";
import { localStore } from "../design/safeStorage";

type Focus = {
  itemId: string;
  title: string;
  minutes: number;
  startedAt: number;
} | null;

const KEY = "crewstead.focus";
const store = createStore<{ focus: Focus; now: number }>({
  focus: null,
  now: Date.now(),
});

function restore(): Focus {
  const value = localStore.getJSON(KEY) as Partial<NonNullable<Focus>> | null;
  if (
    value !== null &&
    typeof value === "object" &&
    typeof value.itemId === "string" &&
    typeof value.title === "string" &&
    typeof value.minutes === "number" &&
    typeof value.startedAt === "number"
  )
    return value as NonNullable<Focus>;
  // A broken record just means no focus block.
  return null;
}

function persist(focus: Focus) {
  if (focus === null) localStore.remove(KEY);
  else localStore.setJSON(KEY, focus);
}

store.set({ focus: restore() });

/** Starts a focus block on an activity (replacing any other one). */
export function startFocus(itemId: string, title: string, minutes: number) {
  const focus = { itemId, title, minutes, startedAt: Date.now() };
  persist(focus);
  store.set({ focus, now: Date.now() });
}

export function useFocus() {
  return store.use().focus;
}

/**
 * The floating focus timer. Finishing (or ending after a few minutes) records
 * the time on the activity; Tela keeps the person company meanwhile.
 */
export function FocusHost() {
  const { focus, now } = store.use();
  const { client } = useWorkspace();
  const { refresh } = useStats();
  const finishing = useRef(false);

  const end = useCallback(
    async (completed: boolean) => {
      const current = store.get().focus;
      if (current === null || finishing.current) return;
      finishing.current = true;
      const minutes = completed
        ? current.minutes
        : elapsedMinutes(current.startedAt, Date.now(), current.minutes);
      persist(null);
      store.set({ focus: null });
      try {
        if (minutes >= (completed ? 1 : MIN_COUNTED_FOCUS)) {
          await recordFocusSession(client, current.itemId, minutes);
          await refresh();
          if (completed) {
            blip("win");
            burst(window.innerWidth / 2, window.innerHeight - 80, {
              count: 50,
              power: 9,
              up: true,
            });
          }
          toast(
            completed
              ? `Foco concluído: ${minutes} min em “${current.title}”.`
              : `${minutes} min de foco registrados.`,
            { icon: "clock", ms: 4200 },
          );
        } else {
          toast("Foco encerrado.", { icon: "clock" });
        }
      } catch {
        toast("Não foi possível registrar o tempo de foco.", { kind: "err" });
      } finally {
        finishing.current = false;
      }
    },
    [client, refresh],
  );

  useEffect(() => {
    if (focus === null) return;
    const tick = window.setInterval(() => {
      const moment = Date.now();
      store.set({ now: moment });
      if (moment - focus.startedAt >= focus.minutes * 60_000) void end(true);
    }, 1000);
    return () => window.clearInterval(tick);
  }, [focus, end]);

  if (focus === null) return null;
  const total = focus.minutes * 60_000;
  const left = total - (now - focus.startedAt);
  const share = Math.min(1, Math.max(0, (now - focus.startedAt) / total));
  return (
    <aside aria-label="Modo foco" className="focuspill" role="timer">
      <span aria-hidden="true" className="focus-sp">
        <Sprite pose="sit" scale={2} who="tela" />
      </span>
      <div className="col grow">
        <b className="num">{clockLabel(left)}</b>
        <span className="xs muted focus-title">{focus.title}</span>
        <span aria-hidden="true" className="focus-bar">
          <i style={{ width: `${share * 100}%` }} />
        </span>
      </div>
      <button className="btn sm" onClick={() => void end(false)} type="button">
        Encerrar
      </button>
    </aside>
  );
}
