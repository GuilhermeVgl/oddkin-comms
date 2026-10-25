import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "../design/icons";
import { nameOf } from "../design/people";
import { getPrefs, setPrefs } from "../design/prefs";
import { go } from "../design/router";
import { useInbox } from "../inbox";
import { useWorkspace } from "../workspace";
import { useShell } from "./context";

type Entry = { label: string; icon: IconName; hint?: string; run: () => void };

/** Ctrl/Cmd K: commands, activities and conversations, searched locally. */
export function Palette({ onClose }: { onClose: () => void }) {
  const { projects, setCurrentProjectId } = useWorkspace();
  const { channels, dms } = useInbox();
  const { openNewItem } = useShell();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  const entries = useMemo(() => {
    const base: Entry[] = [
      { label: "Ir para Visão geral", icon: "home", run: () => go("home") },
      { label: "Ir para Atividades", icon: "board", run: () => go("work") },
      { label: "Ir para Sprints", icon: "flag", run: () => go("sprints") },
      { label: "Ir para Mensagens", icon: "chat", run: () => go("chat") },
      { label: "Abrir Configurações", icon: "gear", run: () => go("settings") },
      {
        label: "Alternar tema",
        icon: "moon",
        run: () =>
          setPrefs({
            theme: getPrefs().theme === "papel" ? "carvao" : "papel",
          }),
      },
      { label: "Nova atividade", icon: "plus", run: () => openNewItem() },
    ];
    const work: Entry[] = (projects ?? []).flatMap((state) =>
      state.items
        .filter((item) => item.kind === "task")
        .map((item): Entry => ({
          label: item.title,
          icon: "board",
          hint: state.project.name,
          run: () => {
            setCurrentProjectId(state.project.id);
            go(`work/${item.id}`);
          },
        })),
    );
    const projectName = (id: string) =>
      projects?.find((state) => state.project.id === id)?.project.name;
    const chats: Entry[] = [
      ...channels.map((channel): Entry => ({
        label: `#${channel.name}`,
        icon: "hash",
        hint: projectName(channel.projectId) ?? "",
        run: () => go(`chat/${channel.id}`),
      })),
      ...dms.map((dm): Entry => ({
        label: nameOf(dm.peerEmail),
        icon: "user",
        hint: "conversa direta",
        run: () => go(`chat/${dm.id}`),
      })),
    ];
    const needle = query.trim().toLowerCase();
    if (needle === "") return base.slice(0, 9);
    return [...base, ...work, ...chats]
      .filter((entry) => entry.label.toLowerCase().includes(needle))
      .slice(0, 9);
  }, [projects, channels, dms, query, openNewItem, setCurrentProjectId]);

  function choose(entry: Entry | undefined) {
    if (entry === undefined) return;
    onClose();
    entry.run();
  }

  return (
    <>
      <div className="scrim" onClick={onClose} style={{ zIndex: 84 }} />
      <div
        aria-label="Paleta de comandos"
        className="cmdk"
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setSelected((value) => Math.min(entries.length - 1, value + 1));
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setSelected((value) => Math.max(0, value - 1));
          }
          if (event.key === "Enter") choose(entries[selected]);
          if (event.key === "Escape") onClose();
        }}
        role="dialog"
      >
        <input
          aria-label="Buscar"
          autoComplete="off"
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
          }}
          placeholder="Buscar atividades, canais, pessoas ou comandos…"
          ref={input}
          value={query}
        />
        <div className="res" role="listbox">
          {entries.map((entry, index) => (
            <button
              aria-selected={index === selected}
              key={`${entry.label}-${index}`}
              onClick={() => choose(entry)}
              role="option"
              type="button"
            >
              <Icon name={entry.icon} size="sm" />
              <span>{entry.label}</span>
              <span className="k">{entry.hint ?? ""}</span>
            </button>
          ))}
          {entries.length === 0 ? (
            <div className="empty" style={{ padding: 24 }}>
              <h3>Nada encontrado</h3>
              <p>Só pesquiso o que já foi sincronizado e liberado para você.</p>
            </div>
          ) : null}
        </div>
        <div className="foot">
          <span>
            <span className="kbd">↑↓</span> navegar
          </span>
          <span>
            <span className="kbd">Enter</span> abrir
          </span>
          <span>
            <span className="kbd">Esc</span> fechar
          </span>
          <span className="grow" />
          <span>
            <Icon name="lock" size="sm" /> busca local, nada vai ao servidor
          </span>
        </div>
      </div>
    </>
  );
}
