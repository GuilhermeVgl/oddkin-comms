import { useState } from "react";
import { reopenColumn, doneColumn } from "../../columns";
import { Icon } from "../../design/icons";
import { blip } from "../../design/sound";
import { toast } from "../../design/toast";
import { startFocus, useFocus } from "../../shell/focus";
import { useItemActions } from "../itemActions";
import type { DrawerEntry } from "./types";
import { useEngagement } from "./useEngagement";

const FOCUS_CHOICES = [15, 25, 50];

/** Encryption badge, focus time, thanks, focus mode and the finish/reopen button. */
export function DrawerFooter({
  entry,
  meId,
  done,
  canMove,
  encrypted,
}: {
  entry: DrawerEntry;
  meId: string;
  done: boolean;
  canMove: boolean;
  encrypted: boolean;
}) {
  const { item, state } = entry;
  const { move } = useItemActions();
  const [focusMinutes, setFocusMinutes] = useState(25);
  const focusing = useFocus();
  const focusActive = focusing?.itemId === item.id;
  const { engagement, thank } = useEngagement(
    item.id,
    item.columnId,
    focusActive,
  );
  const finish = doneColumn(state.columns);

  return (
    <div className="df row">
      {encrypted ? (
        <span className="lock">
          <Icon name="lock" size="sm" />
          Cifrado ponta a ponta
        </span>
      ) : null}
      <span className="xs muted grow mono">v{item.version}</span>
      {engagement !== null && engagement.focusMinutes > 0 ? (
        <span className="tag mute" title="Tempo em modo foco nesta atividade">
          <Icon name="clock" size="sm" />
          {engagement.focusMinutes} min de foco
        </span>
      ) : null}
      {done && item.assigneeId !== undefined && item.assigneeId !== meId ? (
        <button
          aria-pressed={engagement?.kudosMine ?? false}
          className={`btn kudos${engagement?.kudosMine ? " on" : ""}`}
          disabled={engagement === null}
          onClick={() => void thank()}
          type="button"
        >
          <span aria-hidden="true">👏</span>
          {engagement?.kudosMine ? "Você agradeceu" : "Valeu"}
          {engagement !== null && engagement.kudosCount > 0
            ? ` · ${engagement.kudosCount}`
            : ""}
        </button>
      ) : done && engagement !== null && engagement.kudosCount > 0 ? (
        <span className="tag lime">
          <span aria-hidden="true">👏</span> {engagement.kudosCount}
        </span>
      ) : null}
      {!done && canMove ? (
        <span className="row gap8 focus-start">
          <select
            aria-label="Duração do foco"
            className="inp"
            onChange={(event) => setFocusMinutes(Number(event.target.value))}
            value={focusMinutes}
          >
            {FOCUS_CHOICES.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} min
              </option>
            ))}
          </select>
          <button
            className="btn"
            disabled={focusActive}
            onClick={() => {
              startFocus(item.id, item.title, focusMinutes);
              blip("ok");
              toast("Modo foco ligado. Boa concentração.", { icon: "clock" });
            }}
            type="button"
          >
            <Icon name="clock" size="sm" />
            {focusActive ? "Em foco" : "Foco"}
          </button>
        </span>
      ) : null}
      {done ? (
        canMove ? (
          <button
            className="btn"
            onClick={() => {
              const reopen = reopenColumn(state.columns);
              if (reopen !== undefined) void move(state, item, reopen.id);
            }}
            type="button"
          >
            Reabrir
          </button>
        ) : null
      ) : canMove && finish !== undefined ? (
        <button
          className="btn accent"
          onClick={() => void move(state, item, finish.id)}
          type="button"
        >
          <Icon name="check" size="sm" />
          Concluir atividade
        </button>
      ) : null}
    </div>
  );
}
