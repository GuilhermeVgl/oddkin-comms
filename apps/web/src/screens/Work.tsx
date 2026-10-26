import type {
  BoardColumn,
  CurrentAccount,
  WorkItem,
} from "@crewstead/api-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { blip } from "../design/sound";
import { daysTo, fmtD } from "../design/format";
import { Icon } from "../design/icons";
import { Menu, useMenu } from "../design/Menu";
import { firstNameOf, nameOf } from "../design/people";
import { Avatar, Banner, NoAvatar } from "../design/primitives";
import { go } from "../design/router";
import { Sprite } from "../design/Sprite";
import { createStore } from "../design/store";
import { Page } from "../shell/Page";
import { useShell } from "../shell/context";
import { projectColor } from "../shell/Sidebar";
import { isDone, useWorkspace, type ProjectState } from "../workspace";
import {
  ColumnMenu,
  EpicsDialog,
  EncryptionBanner,
  NewProjectDialog,
} from "./WorkExtras";
import { Drawer } from "./Drawer";
import { PRIORITY_ICON, PRIORITY_LABEL } from "./Home";
import { subtasksOf, useItemActions } from "./itemActions";
import { useQuickCreate } from "./quickCreate";

type Scope = "todas" | "minhas" | "semana";
type SortKey = "due" | "title" | "prio" | "p" | "st";

export const board = createStore({
  scope: "todas" as Scope,
  epic: "",
  prio: "",
  assignee: "",
  sprint: "",
  view: "quadro" as "quadro" | "lista",
  allProjects: false,
  sortKey: "due" as SortKey,
  sortDir: 1 as 1 | -1,
});

type Entry = { item: WorkItem; state: ProjectState };

function Card({
  entry,
  onOpen,
  onToggle,
  onMenu,
  onDragStart,
  dragging,
  canMove,
}: {
  entry: Entry;
  onOpen: () => void;
  onToggle: () => void;
  onMenu: (anchor: HTMLElement) => void;
  onDragStart: (event: React.PointerEvent<HTMLElement>) => void;
  dragging: boolean;
  canMove: boolean;
}) {
  const { item, state } = entry;
  const { people } = useWorkspace();
  const done = isDone(state.columns, item.columnId);
  const subs = subtasksOf(state, item);
  const finished = subs.filter((sub) =>
    isDone(state.columns, sub.columnId),
  ).length;
  const late = item.dueDate !== undefined && daysTo(item.dueDate) < 0 && !done;
  const epic =
    item.epicId === undefined
      ? null
      : state.epics.find((value) => value.id === item.epicId);
  const assignee =
    item.assigneeId === undefined ? undefined : people.get(item.assigneeId);
  const column = state.columns.find((value) => value.id === item.columnId);
  return (
    <article
      aria-label={`${item.title}, ${column?.name ?? ""}`}
      className={`wi${done ? " done" : ""}${canMove ? "" : " ro"}${dragging ? " dragging" : ""}`}
      data-id={item.id}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        onOpen();
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
        if (event.key.toLowerCase() === "m") {
          event.currentTarget
            .querySelector<HTMLElement>("[data-cardmenu]")
            ?.click();
        }
      }}
      onPointerDown={onDragStart}
      tabIndex={0}
    >
      <div className="r1">
        <span className="tag">
          <i
            className="pd"
            style={{ background: projectColor(state.project.color) }}
          />
          {state.project.name}
        </span>
        {epic === null || epic === undefined ? null : (
          <span className="tag mute" title="Épico">
            {epic.title}
          </span>
        )}
        <button
          aria-checked={done}
          aria-label={`Concluir ${item.title}`}
          className="chk"
          disabled={!canMove}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
          role="checkbox"
          style={canMove ? undefined : { opacity: 0.4, cursor: "not-allowed" }}
          type="button"
        >
          <Icon name="check" />
        </button>
      </div>
      <h4 className="ttl">{item.title}</h4>
      {item.description === "" ? null : (
        <p className="ds">{item.description}</p>
      )}
      {subs.length > 0 ? (
        <div className="row" title={`${finished} de ${subs.length} subtarefas`}>
          <div aria-hidden="true" className="pbar">
            {subs.slice(0, 8).map((sub) => (
              <i
                className={isDone(state.columns, sub.columnId) ? "on" : ""}
                key={sub.id}
                style={{ width: 8, height: 8 }}
              />
            ))}
          </div>
          <span className="xs num muted">
            {finished}/{subs.length}
          </span>
        </div>
      ) : null}
      <div className="ft">
        <span className="who">
          {assignee === undefined ? (
            <NoAvatar size="sm" />
          ) : (
            <Avatar email={assignee.email} id={assignee.id} size="sm" />
          )}
          <span>
            {assignee === undefined
              ? "Sem responsável"
              : firstNameOf(assignee.email)}
          </span>
        </span>
        {item.priority === "high" || item.priority === "urgent" ? (
          <span className={`prio ${item.priority}`}>
            <Icon name={PRIORITY_ICON[item.priority]} size="sm" />
            {PRIORITY_LABEL[item.priority]}
          </span>
        ) : null}
        {item.dueDate === undefined ? null : (
          <span className={`meta${late ? " over" : ""}`}>
            <Icon name="cal" size="sm" />
            {late ? "Atrasada · " : ""}
            {fmtD(item.dueDate)}
          </span>
        )}
        <button
          aria-label={`Mover ou abrir ${item.title}`}
          className="iconbtn mini"
          data-cardmenu
          onClick={(event) => {
            event.stopPropagation();
            onMenu(event.currentTarget);
          }}
          style={{ marginLeft: "auto" }}
          type="button"
        >
          <Icon name="more" size="sm" />
        </button>
      </div>
    </article>
  );
}

function SkeletonBoard() {
  return (
    <>
      <Banner kind="ok" role="status" style={{ margin: "0 32px 14px" }}>
        <b>Descriptografando neste dispositivo…</b> Títulos e descrições só
        existem em claro aqui.
      </Banner>
      <div className="board">
        {[0, 1, 2, 3].map((column) => (
          <div className="colm" key={column}>
            <div className="colh">
              <span
                className="skel"
                style={{ width: 26, height: 26, borderRadius: "50%" }}
              />
              <span className="skel" style={{ width: 110, height: 16 }} />
            </div>
            {Array.from({ length: 3 - (column % 2) }, (_, index) => (
              <div className="wi" key={index} style={{ cursor: "default" }}>
                <span className="skel" style={{ width: 70, height: 20 }} />
                <span className="skel" style={{ width: "85%", height: 18 }} />
                <span className="skel" style={{ width: "100%", height: 30 }} />
                <span className="skel" style={{ width: "60%", height: 22 }} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

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
};

function Board({
  entries,
  state,
  onOpen,
}: {
  entries: Entry[];
  state: ProjectState;
  onOpen: (item: WorkItem) => void;
}) {
  const { move, toggle } = useItemActions();
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ col: string; index: number } | null>(null);
  const cardMenu = useMenu<Entry>();
  const [adding, setAdding] = useState<string | null>(null);
  const [colMenu, setColMenu] = useState<{
    anchor: HTMLElement;
    column: BoardColumn;
  } | null>(null);
  const justDragged = useRef(false);

  const finish = useCallback(
    (cancel: boolean) => {
      const current = drag.current;
      drag.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      if (current === null || !current.moved) return;
      current.ghost?.remove();
      setDragging(null);
      setOver(null);
      justDragged.current = true;
      window.setTimeout(() => (justDragged.current = false), 0);
      if (cancel || current.col === undefined) return;
      void move(state, current.entry.item, current.col).then((moved) => {
        if (moved) blip("ok");
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
          Math.hypot(
            event.clientX - current.startX,
            event.clientY - current.startY,
          ) < 6
        )
          return;
        const rect = current.card.getBoundingClientRect();
        const ghost = current.card.cloneNode(true) as HTMLElement;
        ghost.classList.add("ghost-card");
        ghost.style.width = `${rect.width}px`;
        ghost.style.left = `${rect.left}px`;
        ghost.style.top = `${rect.top}px`;
        document.body.appendChild(ghost);
        current.ghost = ghost;
        current.offsetX = event.clientX - rect.left;
        current.offsetY = event.clientY - rect.top;
        current.moved = true;
        setDragging(current.entry.item.id);
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
      }
      if (current.ghost !== undefined) {
        current.ghost.style.left = `${event.clientX - (current.offsetX ?? 0)}px`;
        current.ghost.style.top = `${event.clientY - (current.offsetY ?? 0)}px`;
      }
      const container = host.current;
      if (container === null) return;
      const bounds = container.getBoundingClientRect();
      if (event.clientX > bounds.right - 60) container.scrollLeft += 14;
      if (event.clientX < bounds.left + 60) container.scrollLeft -= 14;
      const columns = Array.from(
        container.querySelectorAll<HTMLElement>(".colm"),
      );
      const target = columns.find((column) => {
        const box = column.getBoundingClientRect();
        return event.clientX >= box.left && event.clientX <= box.right;
      });
      if (target === undefined) {
        current.col = undefined;
        setOver(null);
        return;
      }
      const cards = Array.from(
        target.querySelectorAll<HTMLElement>(".wi:not(.dragging)"),
      );
      let index = cards.length;
      for (let position = 0; position < cards.length; position++) {
        const box = cards[position]!.getBoundingClientRect();
        if (event.clientY < box.top + box.height / 2) {
          index = position;
          break;
        }
      }
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

  return (
    <div
      aria-label="Quadro de atividades"
      className="board"
      id="board"
      ref={host}
      role="list"
    >
      {state.columns.map((column, position) => {
        const cards = entries.filter(
          (entry) => entry.item.columnId === column.id,
        );
        const placeholderAt = over?.col === column.id ? over.index : -1;
        const dropping = over?.col === column.id;
        const visible = cards.filter((entry) => entry.item.id !== dragging);
        return (
          <section
            aria-label={`${column.name}, ${cards.length} atividades`}
            className={`colm${dropping ? " over" : ""}`}
            data-col={column.id}
            key={column.id}
            role="listitem"
          >
            <div className="colh">
              <span className="n num">{cards.length}</span>
              <h3>{column.name}</h3>
              <span className="cat">
                {column.category === "done" ? "concluída" : ""}
              </span>
              {state.project.isManager ? (
                <button
                  aria-label={`Opções da coluna ${column.name}`}
                  className="iconbtn mini"
                  onClick={(event) =>
                    setColMenu((value) =>
                      value?.column.id === column.id
                        ? null
                        : { anchor: event.currentTarget, column },
                    )
                  }
                  type="button"
                >
                  <Icon name="more" size="sm" />
                </button>
              ) : null}
            </div>
            <div className="cards">
              {cards.length === 0 && !dropping ? (
                <div className="emptycol">
                  <div className="emp-sp">
                    <Sprite
                      pose="sleep"
                      scale={2}
                      who={position % 2 === 0 ? "tela" : "capuz"}
                    />
                  </div>
                  <span className="pixel" style={{ fontSize: 16 }}>
                    {column.category === "done"
                      ? "Nada concluído ainda"
                      : "Coluna vazia"}
                  </span>
                  <span className="xs">Arraste um cartão para cá.</span>
                </div>
              ) : null}
              {cards.flatMap((entry, index) => {
                const out: React.ReactNode[] = [];
                const visibleIndex = visible.findIndex(
                  (value) => value.item.id === entry.item.id,
                );
                if (placeholderAt >= 0 && visibleIndex === placeholderAt)
                  out.push(<div className="ph" key={`ph-${index}`} />);
                out.push(
                  <Card
                    canMove
                    dragging={dragging === entry.item.id}
                    entry={entry}
                    key={entry.item.id}
                    onDragStart={(event) => {
                      if (
                        event.button !== 0 ||
                        event.pointerType === "touch" ||
                        (event.target as HTMLElement).closest(
                          "button,a,input,select",
                        ) !== null
                      )
                        return;
                      drag.current = {
                        entry,
                        card: event.currentTarget,
                        startX: event.clientX,
                        startY: event.clientY,
                        moved: false,
                      };
                    }}
                    onMenu={(anchor) => cardMenu.toggle(anchor, entry)}
                    onOpen={() => {
                      if (justDragged.current) return;
                      onOpen(entry.item);
                    }}
                    onToggle={() => void toggle(state, entry.item)}
                  />,
                );
                return out;
              })}
              {placeholderAt >= visible.length && dropping ? (
                <div className="ph" />
              ) : null}
            </div>
            {column.category === "todo" || position === 0 ? (
              adding === column.id ? (
                <InlineAdd
                  column={column}
                  onDone={() => setAdding(null)}
                  state={state}
                />
              ) : (
                <button
                  className="addcard"
                  onClick={() => setAdding(column.id)}
                  type="button"
                >
                  <Icon name="plus" size="sm" /> Adicionar atividade
                </button>
              )
            ) : null}
          </section>
        );
      })}
      {cardMenu.state === null ? null : (
        <Menu anchor={cardMenu.state.anchor} onClose={cardMenu.close} right>
          <div className="mh">Mover para</div>
          {cardMenu.state.data.state.columns.map((column) => (
            <button
              aria-current={
                column.id === cardMenu.state?.data.item.columnId
                  ? "true"
                  : undefined
              }
              key={column.id}
              onClick={() => {
                const target = cardMenu.state?.data;
                cardMenu.close();
                if (target !== undefined)
                  void move(target.state, target.item, column.id);
              }}
              role="menuitem"
              type="button"
            >
              <Icon
                name={column.category === "done" ? "check" : "right"}
                size="sm"
              />
              {column.name}
            </button>
          ))}
          <hr />
          <button
            onClick={() => {
              const target = cardMenu.state?.data;
              cardMenu.close();
              if (target !== undefined) onOpen(target.item);
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="eye" size="sm" />
            Abrir detalhe
          </button>
        </Menu>
      )}
      {colMenu === null ? null : (
        <ColumnMenu
          anchor={colMenu.anchor}
          column={colMenu.column}
          onClose={() => setColMenu(null)}
          state={state}
        />
      )}
    </div>
  );
}

function InlineAdd({
  column,
  state,
  onDone,
}: {
  column: BoardColumn;
  state: ProjectState;
  onDone: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const { createQuick } = useQuickCreate();
  useEffect(() => input.current?.focus(), []);
  return (
    <div>
      <input
        aria-label="Título da nova atividade"
        className="inp"
        maxLength={200}
        onBlur={() =>
          window.setTimeout(() => input.current?.value === "" && onDone(), 120)
        }
        onKeyDown={(event) => {
          if (event.key === "Escape") onDone();
          if (
            event.key === "Enter" &&
            event.currentTarget.value.trim() !== ""
          ) {
            const title = event.currentTarget.value.trim();
            onDone();
            void createQuick(state, column.id, title);
          }
        }}
        placeholder="Título da atividade e Enter"
        ref={input}
      />
      <span className="xs muted">Enter cria · Esc cancela</span>
    </div>
  );
}

function ListView({
  entries,
  showProject,
  onOpen,
}: {
  entries: Entry[];
  showProject: boolean;
  onOpen: (entry: Entry) => void;
}) {
  const { sprints, people } = useWorkspace();
  const prefs = board.use();
  const keyOf = (entry: Entry): string | number => {
    const { item, state } = entry;
    switch (prefs.sortKey) {
      case "due":
        return item.dueDate ?? "9999";
      case "title":
        return item.title.toLowerCase();
      case "prio":
        return ["urgent", "high", "normal", "low"].indexOf(item.priority);
      case "p":
        return state.project.name;
      case "st":
        return state.columns.findIndex((column) => column.id === item.columnId);
    }
  };
  const sorted = [...entries].sort(
    (left, right) => (keyOf(left) > keyOf(right) ? 1 : -1) * prefs.sortDir,
  );
  const head = (key: SortKey, label: string) => (
    <th
      aria-sort={
        prefs.sortKey === key
          ? prefs.sortDir > 0
            ? "ascending"
            : "descending"
          : "none"
      }
      scope="col"
    >
      <button
        onClick={() =>
          board.set(
            prefs.sortKey === key
              ? { sortDir: prefs.sortDir === 1 ? -1 : 1 }
              : { sortKey: key, sortDir: 1 },
          )
        }
        type="button"
      >
        {label}
        {prefs.sortKey === key ? (
          <Icon name={prefs.sortDir > 0 ? "up" : "down"} size="sm" />
        ) : null}
      </button>
    </th>
  );
  return (
    <div style={{ padding: "0 32px 24px", overflow: "auto" }}>
      <div className="card" style={{ overflow: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              {head("title", "Atividade")}
              {showProject ? head("p", "Projeto") : null}
              <th scope="col">Responsável</th>
              {head("st", "Estado")}
              {head("prio", "Prioridade")}
              {head("due", "Prazo")}
              <th scope="col">Sprint</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((entry) => {
              const { item, state } = entry;
              const done = isDone(state.columns, item.columnId);
              const late =
                item.dueDate !== undefined && daysTo(item.dueDate) < 0 && !done;
              const subs = subtasksOf(state, item);
              const assignee =
                item.assigneeId === undefined
                  ? undefined
                  : people.get(item.assigneeId);
              const sprint = sprints.find(
                (value) => value.id === item.sprintId,
              );
              return (
                <tr
                  key={item.id}
                  onClick={() => onOpen(entry)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpen(entry);
                    }
                  }}
                  tabIndex={0}
                >
                  <td>
                    <b
                      style={{
                        fontWeight: 650,
                        ...(done
                          ? {
                              textDecoration: "line-through",
                              color: "var(--ink-2)",
                            }
                          : {}),
                      }}
                    >
                      {item.title}
                    </b>
                    {subs.length > 0 ? (
                      <span className="xs muted num">
                        {" "}
                        ·{" "}
                        {
                          subs.filter((sub) =>
                            isDone(state.columns, sub.columnId),
                          ).length
                        }
                        /{subs.length}
                      </span>
                    ) : null}
                  </td>
                  {showProject ? (
                    <td>
                      <span className="tag">
                        <i
                          className="pd"
                          style={{
                            background: projectColor(state.project.color),
                          }}
                        />
                        {state.project.name}
                      </span>
                    </td>
                  ) : null}
                  <td>
                    <span className="row gap8">
                      {assignee === undefined ? (
                        <>
                          <NoAvatar size="sm" />
                          <span className="muted">Sem responsável</span>
                        </>
                      ) : (
                        <>
                          <Avatar
                            email={assignee.email}
                            id={assignee.id}
                            size="sm"
                          />
                          {firstNameOf(assignee.email)}
                        </>
                      )}
                    </span>
                  </td>
                  <td>
                    <span className={`tag ${done ? "lime" : "mute"}`}>
                      {
                        state.columns.find(
                          (column) => column.id === item.columnId,
                        )?.name
                      }
                    </span>
                  </td>
                  <td>
                    <span className={`prio ${item.priority}`}>
                      <Icon name={PRIORITY_ICON[item.priority]} size="sm" />
                      {PRIORITY_LABEL[item.priority]}
                    </span>
                  </td>
                  <td
                    style={
                      late
                        ? { color: "var(--danger)", fontWeight: 650 }
                        : undefined
                    }
                  >
                    {item.dueDate === undefined ? (
                      <span className="muted">—</span>
                    ) : (
                      `${late ? "Atrasada · " : ""}${fmtD(item.dueDate)}`
                    )}
                  </td>
                  <td>
                    {sprint === undefined ? (
                      <span className="muted">Backlog</span>
                    ) : (
                      sprint.name
                    )}
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <div className="empty">
                    <div className="emp-sp2">
                      <Sprite pose="sleep" scale={3} who="capuz" />
                    </div>
                    <h3>Nada por aqui</h3>
                    <p>Nenhuma atividade combina com os filtros atuais.</p>
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Work({
  account,
  itemId,
}: {
  account: CurrentAccount;
  itemId: string | null;
}) {
  const { projects, current, setCurrentProjectId, sprints, people } =
    useWorkspace();
  const { openNewItem } = useShell();
  const prefs = board.use();
  const [epicsOpen, setEpicsOpen] = useState(false);
  const filters = useMenu();
  useEffect(() => {
    const open = () => setNewProject(true);
    window.addEventListener("crewstead:new-project", open);
    return () => window.removeEventListener("crewstead:new-project", open);
  }, []);
  const [newProject, setNewProject] = useState(false);

  const list = prefs.view === "lista";
  const all = list && prefs.allProjects;
  const states = useMemo(
    () => (all ? (projects ?? []) : current === null ? [] : [current]),
    [all, projects, current],
  );

  const entries = useMemo(() => {
    let rows: Entry[] = states.flatMap((state) =>
      state.items
        .filter((item) => item.kind === "task")
        .map((item) => ({ item, state })),
    );
    if (prefs.scope === "minhas")
      rows = rows.filter(({ item }) => item.assigneeId === account.id);
    if (prefs.scope === "semana")
      rows = rows.filter(
        ({ item, state }) =>
          item.dueDate !== undefined &&
          daysTo(item.dueDate) <= 7 &&
          !isDone(state.columns, item.columnId),
      );
    if (prefs.epic !== "")
      rows = rows.filter(({ item }) => item.epicId === prefs.epic);
    if (prefs.prio !== "")
      rows = rows.filter(({ item }) => item.priority === prefs.prio);
    if (prefs.assignee === "none")
      rows = rows.filter(({ item }) => item.assigneeId === undefined);
    else if (prefs.assignee !== "")
      rows = rows.filter(({ item }) => item.assigneeId === prefs.assignee);
    if (prefs.sprint === "backlog")
      rows = rows.filter(({ item }) => item.sprintId === undefined);
    else if (prefs.sprint !== "")
      rows = rows.filter(({ item }) => item.sprintId === prefs.sprint);
    return rows;
  }, [
    states,
    prefs.scope,
    prefs.epic,
    prefs.prio,
    prefs.assignee,
    prefs.sprint,
    account.id,
  ]);

  // A deep link to an activity opens its drawer and selects its project.
  const target = useMemo(() => {
    if (itemId === null) return null;
    for (const state of projects ?? []) {
      const item = state.items.find((value) => value.id === itemId);
      if (item !== undefined) return { item, state };
    }
    return null;
  }, [itemId, projects]);

  useEffect(() => {
    if (target !== null && target.state.project.id !== current?.project.id)
      setCurrentProjectId(target.state.project.id);
  }, [target, current, setCurrentProjectId]);

  const epics = (all ? (projects ?? []) : states).flatMap(
    (state) => state.epics,
  );
  const members = new Map<string, string>();
  for (const state of states)
    for (const member of state.members)
      members.set(member.accountId, member.email);
  const loading = projects === null;
  const extraFilters =
    (prefs.assignee === "" ? 0 : 1) + (prefs.sprint === "" ? 0 : 1);

  return (
    <Page
      cta={
        <button
          className="btn primary"
          disabled={(projects ?? []).length === 0}
          onClick={() => openNewItem(current?.project.id)}
          type="button"
        >
          <Icon name="plus" /> Nova atividade
        </button>
      }
      flush
      placeholder="Buscar atividades…"
      sub="Pequenos passos. Grandes entregas."
      title="Atividades"
    >
      <div className="col" style={{ height: "100%" }}>
        <div aria-label="Filtros" className="toolbar" role="toolbar">
          <div aria-label="Escopo" className="pill-tabs" role="group">
            {(
              [
                ["todas", "Todas"],
                ["minhas", "Minhas"],
                ["semana", "Esta semana"],
              ] as const
            ).map(([key, label]) => (
              <button
                aria-pressed={prefs.scope === key}
                className="pill"
                key={key}
                onClick={() => board.set({ scope: key })}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          <span className="sep" style={{ width: 1, height: 24 }} />
          <div aria-label="Projeto" className="pill-tabs" role="group">
            {list && (projects ?? []).length > 1 ? (
              <button
                aria-pressed={all}
                className="pill"
                onClick={() => board.set({ allProjects: true, epic: "" })}
                type="button"
              >
                Todos
              </button>
            ) : null}
            {(projects ?? []).map((state) => (
              <button
                aria-pressed={!all && current?.project.id === state.project.id}
                className="pill"
                key={state.project.id}
                onClick={() => {
                  board.set({ allProjects: false, epic: "" });
                  setCurrentProjectId(state.project.id);
                }}
                type="button"
              >
                <i
                  className="pd"
                  style={{ background: projectColor(state.project.color) }}
                />
                {state.project.name}
              </button>
            ))}
          </div>
          <label className="sr" htmlFor="fe">
            Épico
          </label>
          <select
            className="inp"
            id="fe"
            onChange={(event) => board.set({ epic: event.target.value })}
            style={{ width: "auto", height: 38 }}
            value={prefs.epic}
          >
            <option value="">Todos os épicos</option>
            {epics.map((epic) => (
              <option key={epic.id} value={epic.id}>
                {epic.title}
              </option>
            ))}
          </select>
          <label className="sr" htmlFor="fp">
            Prioridade
          </label>
          <select
            className="inp"
            id="fp"
            onChange={(event) => board.set({ prio: event.target.value })}
            style={{ width: "auto", height: 38 }}
            value={prefs.prio}
          >
            <option value="">Qualquer prioridade</option>
            {(
              Object.keys(PRIORITY_LABEL) as (keyof typeof PRIORITY_LABEL)[]
            ).map((key) => (
              <option key={key} value={key}>
                {PRIORITY_LABEL[key]}
              </option>
            ))}
          </select>
          <button
            aria-expanded={filters.state !== null}
            className="btn"
            onClick={(event) => filters.toggle(event.currentTarget, undefined)}
            style={{ height: 38 }}
            type="button"
          >
            <Icon name="filter" size="sm" />
            Filtros{extraFilters > 0 ? ` · ${extraFilters}` : ""}
          </button>
          <div className="grow" />
          <div aria-label="Visualização" className="seg" role="group">
            <button
              aria-pressed={!list}
              onClick={() => board.set({ view: "quadro", allProjects: false })}
              type="button"
            >
              <Icon name="board" size="sm" />
              Quadro
            </button>
            <button
              aria-pressed={list}
              onClick={() => board.set({ view: "lista" })}
              type="button"
            >
              <Icon name="list" size="sm" />
              Lista
            </button>
          </div>
        </div>
        {loading ? (
          <SkeletonBoard />
        ) : (projects ?? []).length === 0 ? (
          <div className="empty">
            <div className="emp-sp">
              <Sprite pose="sleep" scale={4} who="capuz" />
            </div>
            <h3>O mapa está livre</h3>
            <p>
              {account.isAdmin
                ? "Crie o primeiro projeto para começar."
                : "Você ainda não participa de nenhum projeto."}
            </p>
            {account.isAdmin ? (
              <button
                className="btn primary"
                onClick={() => setNewProject(true)}
                type="button"
              >
                <Icon name="plus" /> Novo projeto
              </button>
            ) : null}
          </div>
        ) : (
          <>
            {current !== null && !all ? (
              <EncryptionBanner state={current} />
            ) : null}
            {current !== null && !current.canRead ? (
              <Banner style={{ margin: "0 32px 14px" }}>
                Seu perfil neste projeto não permite ver as atividades.
              </Banner>
            ) : null}
            {list ? (
              <ListView
                entries={entries}
                onOpen={(entry) => {
                  setCurrentProjectId(entry.state.project.id);
                  go(`work/${entry.item.id}`);
                }}
                showProject={all}
              />
            ) : current === null ? null : (
              <Board
                entries={entries}
                onOpen={(item) => go(`work/${item.id}`)}
                state={current}
              />
            )}
          </>
        )}
      </div>
      {filters.state === null ? null : (
        <Menu
          anchor={filters.state.anchor}
          className="filtermenu"
          focusFirst={false}
          onClose={filters.close}
          right
        >
          <div className="field" style={{ padding: "8px 10px" }}>
            <label htmlFor="fa">Responsável</label>
            <select
              className="inp"
              id="fa"
              onChange={(event) => board.set({ assignee: event.target.value })}
              value={prefs.assignee}
            >
              <option value="">Qualquer responsável</option>
              <option value="none">Sem responsável</option>
              {[...members.entries()].map(([id, email]) => (
                <option key={id} value={id}>
                  {nameOf(people.get(id)?.email ?? email)}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ padding: "8px 10px" }}>
            <label htmlFor="fs">Sprint</label>
            <select
              className="inp"
              id="fs"
              onChange={(event) => board.set({ sprint: event.target.value })}
              value={prefs.sprint}
            >
              <option value="">Qualquer sprint</option>
              <option value="backlog">Backlog</option>
              {sprints
                .filter((sprint) => sprint.state !== "closed")
                .map((sprint) => (
                  <option key={sprint.id} value={sprint.id}>
                    {sprint.name}
                  </option>
                ))}
            </select>
          </div>
          {extraFilters > 0 ? (
            <button
              onClick={() => board.set({ assignee: "", sprint: "" })}
              role="menuitem"
              type="button"
            >
              <Icon name="x" size="sm" />
              Limpar filtros
            </button>
          ) : null}
          {current?.project.isManager || account.isAdmin ? (
            <>
              <hr />
              <button
                onClick={() => {
                  filters.close();
                  setEpicsOpen(true);
                }}
                role="menuitem"
                type="button"
              >
                <Icon name="layers" size="sm" />
                Gerenciar épicos…
              </button>
            </>
          ) : null}
        </Menu>
      )}
      {target === null ? null : (
        <Drawer entry={target} onClose={() => go("work")} />
      )}
      {epicsOpen && current !== null ? (
        <EpicsDialog onClose={() => setEpicsOpen(false)} state={current} />
      ) : null}
      {newProject ? (
        <NewProjectDialog onClose={() => setNewProject(false)} />
      ) : null}
    </Page>
  );
}
