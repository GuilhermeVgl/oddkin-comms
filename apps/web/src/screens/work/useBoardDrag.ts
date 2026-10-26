import type { WorkItem } from "@crewstead/api-client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { isReduced } from "../../design/prefs";
import { blip } from "../../design/sound";
import { stepSpring, tiltFor, type SpringState } from "../../design/spring";
import type { ProjectState } from "../../workspace";
import {
  canStartDrag,
  columnIndexAt,
  dropIndex,
  ghostTransform,
  pastDragThreshold,
  scrollDelta,
  type Entry,
} from "./workRules";

type DragState = {
  entry: Entry;
  card: HTMLElement;
  startX: number;
  startY: number;
  moved: boolean;
  ghost?: HTMLElement;
  offsetX?: number;
  offsetY?: number;
  col?: string | undefined;
  index?: number;
  spring?: SpringState;
  targetX?: number;
  targetY?: number;
  raf?: number;
};

type Move = (
  state: ProjectState,
  item: WorkItem,
  columnId: string,
) => Promise<boolean>;

/** A floating copy of the card that follows the pointer on a spring. */
function startGhost(
  current: DragState,
  event: PointerEvent,
  drag: RefObject<DragState | null>,
) {
  const rect = current.card.getBoundingClientRect();
  const ghost = current.card.cloneNode(true) as HTMLElement;
  ghost.classList.add("ghost-card");
  ghost.style.width = `${rect.width}px`;
  ghost.style.left = "0";
  ghost.style.top = "0";
  ghost.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
  document.body.appendChild(ghost);
  current.ghost = ghost;
  current.spring = { x: rect.left, y: rect.top, vx: 0, vy: 0 };
  current.targetX = rect.left;
  current.targetY = rect.top;
  const reduced = isReduced();
  const tick = () => {
    const live = drag.current;
    if (live === null || live.ghost === undefined || live.spring === undefined)
      return;
    live.spring = reduced
      ? { x: live.targetX ?? 0, y: live.targetY ?? 0, vx: 0, vy: 0 }
      : stepSpring(live.spring, live.targetX ?? 0, live.targetY ?? 0);
    const lean = reduced ? 0 : tiltFor(live.spring.vx);
    live.ghost.style.transform = ghostTransform(live.spring, lean);
    live.raf = requestAnimationFrame(tick);
  };
  current.raf = requestAnimationFrame(tick);
  current.offsetX = event.clientX - rect.left;
  current.offsetY = event.clientY - rect.top;
  current.moved = true;
  document.body.style.userSelect = "none";
  document.body.style.cursor = "grabbing";
}

/** After a card lands, plays the short "settle" pop on the real card. */
function settle(itemId: string) {
  window.setTimeout(() => {
    const landed = document.querySelector<HTMLElement>(
      `.wi[data-id="${itemId}"]`,
    );
    if (landed === null) return;
    landed.classList.add("settle");
    landed.addEventListener(
      "animationend",
      () => landed.classList.remove("settle"),
      { once: true },
    );
  }, 30);
}

/**
 * Pointer-driven dragging of cards between board columns: a spring-following
 * ghost, an insertion placeholder and a move when the card is released.
 */
export function useBoardDrag(state: ProjectState, move: Move) {
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const justDragged = useRef(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ col: string; index: number } | null>(null);

  const finish = useCallback(
    (cancel: boolean) => {
      const current = drag.current;
      drag.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      if (current === null || !current.moved) return;
      if (current.raf !== undefined) cancelAnimationFrame(current.raf);
      const ghost = current.ghost;
      if (ghost !== undefined) {
        if (cancel || current.col === undefined) ghost.remove();
        else {
          // A quick shrink-into-place, then the real card settles with a pop.
          ghost.classList.add("ghost-drop");
          window.setTimeout(() => ghost.remove(), 160);
        }
      }
      setDragging(null);
      setOver(null);
      justDragged.current = true;
      window.setTimeout(() => (justDragged.current = false), 0);
      if (cancel || current.col === undefined) return;
      void move(state, current.entry.item, current.col).then((moved) => {
        if (!moved) return;
        blip("ok");
        settle(current.entry.item.id);
      });
    },
    [move, state],
  );

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const current = drag.current;
      if (current === null) return;
      if (!current.moved) {
        if (
          !pastDragThreshold(
            event.clientX - current.startX,
            event.clientY - current.startY,
          )
        )
          return;
        startGhost(current, event, drag);
        setDragging(current.entry.item.id);
      }
      current.targetX = event.clientX - (current.offsetX ?? 0);
      current.targetY = event.clientY - (current.offsetY ?? 0);
      const container = host.current;
      if (container === null) return;
      container.scrollLeft += scrollDelta(
        event.clientX,
        container.getBoundingClientRect(),
      );
      const columns = Array.from(
        container.querySelectorAll<HTMLElement>(".colm"),
      );
      const target =
        columns[
          columnIndexAt(
            columns.map((column) => column.getBoundingClientRect()),
            event.clientX,
          )
        ];
      if (target === undefined) {
        current.col = undefined;
        setOver(null);
        return;
      }
      const cards = Array.from(
        target.querySelectorAll<HTMLElement>(".wi:not(.dragging)"),
      );
      const index = dropIndex(
        cards.map((card) => card.getBoundingClientRect()),
        event.clientY,
      );
      current.col = target.dataset["col"];
      current.index = index;
      setOver({ col: target.dataset["col"] ?? "", index });
    };
    const up = () => finish(false);
    const cancel = () => finish(true);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && drag.current?.moved === true) finish(true);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("keydown", key);
    };
  }, [finish]);

  /** Pointer-down handler for a card; remembers it until the pointer moves. */
  function pressCard(entry: Entry, event: ReactPointerEvent<HTMLElement>) {
    if (
      !canStartDrag({
        button: event.button,
        pointerType: event.pointerType,
        onControl:
          (event.target as HTMLElement).closest("button,a,input,select") !==
          null,
      })
    )
      return;
    drag.current = {
      entry,
      card: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
  }

  return { host, dragging, over, justDragged, pressCard };
}
