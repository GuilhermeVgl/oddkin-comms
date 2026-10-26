import type { BoardColumn } from "@crewstead/api-client";
import { useEffect, useRef } from "react";
import type { ProjectState } from "../../workspace";
import { useQuickCreate } from "../quickCreate";

export function InlineAdd({
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
