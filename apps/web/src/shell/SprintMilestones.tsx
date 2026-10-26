import { useEffect, useRef } from "react";
import { milestoneCrossed } from "../design/gamify";
import { blip } from "../design/sound";
import { burst } from "../design/sprites";
import { toast } from "../design/toast";
import { isDone, useWorkspace } from "../workspace";

const LINES: Record<number, string> = {
  25: "Um quarto da sprint entregue.",
  50: "Metade da sprint entregue.",
  75: "Três quartos! Falta pouco.",
  100: "Tudo entregue. Que sprint!",
};

/** Cheers when the active sprint crosses 25, 50, 75 and 100% delivered. */
export function SprintMilestones() {
  const { projects, sprints } = useWorkspace();
  const last = useRef<{ sprintId: string; done: number } | null>(null);
  const active = sprints.find((sprint) => sprint.state === "active");

  const tasks =
    active === undefined || projects === null
      ? null
      : projects.flatMap((state) =>
          state.items
            .filter(
              (item) => item.kind === "task" && item.sprintId === active.id,
            )
            .map((item) => isDone(state.columns, item.columnId)),
        );
  const total = tasks?.length ?? 0;
  const done = tasks?.filter(Boolean).length ?? 0;

  useEffect(() => {
    if (active === undefined || tasks === null) return;
    const before = last.current;
    last.current = { sprintId: active.id, done };
    // The first reading of a sprint is only a baseline.
    if (before === null || before.sprintId !== active.id) return;
    const crossed = milestoneCrossed(before.done, done, total);
    if (crossed === null) return;
    blip("win");
    burst(window.innerWidth / 2, window.innerHeight / 3, {
      count: crossed === 100 ? 90 : 40,
      power: crossed === 100 ? 12 : 8,
    });
    toast(LINES[crossed] ?? "", { icon: "flag", ms: 4200 });
  }, [active, tasks, done, total]);

  return null;
}
