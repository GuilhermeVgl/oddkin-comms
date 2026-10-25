import type { CurrentAccount } from "@oddkin/api-client";
import { useRef, useState } from "react";
import { Icon, Logo, type IconName } from "../design/icons";
import { Menu } from "../design/Menu";
import { nameOf } from "../design/people";
import { Avatar } from "../design/primitives";
import { getPrefs, setPrefs } from "../design/prefs";
import { go, useRoute, type RouteName } from "../design/router";
import { Duo, type DuoRef } from "../design/Sprite";
import { toast } from "../design/toast";
import { useInbox } from "../inbox";
import { useWorkspace } from "../workspace";

const SAYS = [
  "Pequenos passos. Grandes entregas.",
  "Criar. Testar. Repetir.",
  "Sem pressa. Sem bagunça.",
  "Respira. Depois a próxima.",
  "Oi! Eu cuido do que está cifrado.",
];

export function roleOf(account: CurrentAccount): string {
  if (account.isAdmin) return "Gestor · administrador";
  return account.membershipKind === "internal" ? "Membro interno" : "Externo";
}

export function projectColor(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#63745a";
}

type MenuKind = "org" | "me";

export function Sidebar({
  account,
  onLogout,
}: {
  account: CurrentAccount;
  onLogout: () => void;
}) {
  const route = useRoute();
  const { projects, current, setCurrentProjectId } = useWorkspace();
  const { unread, channels } = useInbox();
  const dock = useRef<DuoRef>(null);
  const [menu, setMenu] = useState<{
    kind: MenuKind;
    anchor: HTMLElement;
  } | null>(null);
  const external = account.membershipKind === "external";

  const link = (
    name: RouteName,
    icon: IconName,
    label: string,
    badge?: number,
  ) => (
    <a
      aria-current={route.name === name ? "page" : undefined}
      href={`#/${name}`}
    >
      <Icon name={icon} />
      {label}
      {badge !== undefined && badge > 0 ? (
        <span aria-label={`${badge} não lidas`} className="badge">
          {badge}
        </span>
      ) : null}
    </a>
  );

  const projectChannels = channels.filter(
    (entry) => entry.projectId === current?.project.id,
  );
  const toggle =
    (kind: MenuKind) => (event: React.MouseEvent<HTMLButtonElement>) => {
      const anchor = event.currentTarget;
      setMenu((value) => (value?.kind === kind ? null : { kind, anchor }));
    };

  return (
    <aside aria-label="Navegação principal" className="side">
      <a aria-label="ODDKIN, início" className="brand" href="#/home">
        <Logo />
        <span>Oddkin</span>
      </a>
      <button className="orgbtn" onClick={toggle("org")} type="button">
        <span className="tile">O</span>
        <span className="nm">Oddkin Labs</span>
        <Icon name="down" size="sm" />
      </button>
      <nav aria-label="Seções" className="nav">
        {link("home", "home", "Visão geral")}
        {link("work", "board", "Atividades")}
        {link("sprints", "flag", "Sprints")}
        {link("chat", "chat", "Mensagens", unread)}
        {external ? null : link("team", "team", "Equipe")}
        {link("settings", "gear", "Configurações")}
        <div className="glabel row" style={{ gap: 0 }}>
          <span className="grow">Projetos</span>
          {account.isAdmin ? (
            <button
              aria-label="Novo projeto"
              className="iconbtn mini"
              onClick={() => {
                go("work");
                window.setTimeout(
                  () => window.dispatchEvent(new Event("oddkin:new-project")),
                  50,
                );
              }}
              style={{ color: "var(--side-muted)", width: 24, height: 24 }}
              type="button"
            >
              <Icon name="plus" size="sm" />
            </button>
          ) : null}
        </div>
        {(projects ?? []).map(({ project }) => (
          <button
            className="navi proj"
            key={project.id}
            onClick={() => {
              setCurrentProjectId(project.id);
              go(route.name === "chat" ? "chat" : "work");
            }}
            type="button"
          >
            <i
              className="dot"
              style={{ background: projectColor(project.color) }}
            />
            {project.name}
          </button>
        ))}
        {projectChannels.length > 0 && current !== null ? (
          <>
            <div className="glabel">Canais · {current.project.name}</div>
            {projectChannels.map((channel) => (
              <a
                aria-current={
                  route.name === "chat" && route.arg === channel.id
                    ? "page"
                    : undefined
                }
                className="chan"
                href={`#/chat/${channel.id}`}
                key={channel.id}
              >
                <Icon name="hash" size="sm" />
                {channel.name}
                {channel.unread > 0 ? (
                  <span className="badge">{channel.unread}</span>
                ) : null}
              </a>
            ))}
          </>
        ) : null}
      </nav>
      <div className="spacer" />
      <button
        aria-label="Falar com Capuz e Tela"
        className="mascot-dock"
        onClick={() => {
          dock.current?.set("wave", 1600);
          toast(
            SAYS[Math.floor(Math.random() * SAYS.length)] ?? SAYS[0] ?? "",
            {
              mascot: Math.random() < 0.5 ? "tela" : "capuz",
              pose: "wave",
              ms: 2600,
            },
          );
        }}
        type="button"
      >
        <Duo gap={4} ref={dock} scale={2} />
      </button>
      <button className="me" onClick={toggle("me")} type="button">
        <Avatar email={account.email} id={account.id} />
        <span className="nm">
          {nameOf(account.email)}
          <span className="rl">{roleOf(account)}</span>
        </span>
        <Icon name="down" size="sm" />
      </button>
      {menu?.kind === "org" ? (
        <Menu anchor={menu.anchor} onClose={() => setMenu(null)}>
          <div className="mh">Organização</div>
          <button aria-current="true" role="menuitem" type="button">
            <Icon name="check" size="sm" />
            Oddkin Labs
          </button>
          <div className="mh" style={{ fontWeight: 500, maxWidth: 220 }}>
            Uma organização por instalação, sem cadastro público.
          </div>
        </Menu>
      ) : null}
      {menu?.kind === "me" ? (
        <Menu anchor={menu.anchor} onClose={() => setMenu(null)} up>
          <button
            onClick={() => {
              setMenu(null);
              go("settings");
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="user" size="sm" />
            Perfil e aparência
          </button>
          <button
            onClick={() => {
              setMenu(null);
              go("settings/dispositivos");
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="laptop" size="sm" />
            Dispositivos e sessões
          </button>
          <button
            onClick={() => {
              setMenu(null);
              setPrefs({
                theme: getPrefs().theme === "papel" ? "carvao" : "papel",
              });
            }}
            role="menuitem"
            type="button"
          >
            <Icon
              name={getPrefs().theme === "papel" ? "moon" : "sun"}
              size="sm"
            />
            Tema {getPrefs().theme === "papel" ? "Carvão" : "Papel"}
          </button>
          <hr />
          <button
            onClick={() => {
              setMenu(null);
              onLogout();
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="out" size="sm" />
            Sair
          </button>
        </Menu>
      ) : null}
    </aside>
  );
}

/** The bottom bar on phones. */
export function MobileNav({
  account,
  onLogout,
}: {
  account: CurrentAccount;
  onLogout: () => void;
}) {
  const route = useRoute();
  const { unread } = useInbox();
  const [more, setMore] = useState<HTMLElement | null>(null);
  const external = account.membershipKind === "external";
  const item = (
    name: RouteName,
    icon: IconName,
    label: string,
    badge?: number,
  ) => (
    <button
      aria-current={route.name === name ? "page" : undefined}
      onClick={() => go(name)}
      type="button"
    >
      <Icon name={icon} />
      {label}
      {badge !== undefined && badge > 0 ? (
        <span className="badge">{badge}</span>
      ) : null}
    </button>
  );
  return (
    <nav aria-label="Navegação" className="mobnav">
      {item("home", "home", "Início")}
      {item("work", "board", "Atividades")}
      {item("sprints", "flag", "Sprints")}
      {item("chat", "chat", "Mensagens", unread)}
      <button
        onClick={(event) => {
          const anchor = event.currentTarget;
          setMore((value) => (value === anchor ? null : anchor));
        }}
        type="button"
      >
        <Icon name="more" />
        Mais
      </button>
      {more === null ? null : (
        <Menu anchor={more} onClose={() => setMore(null)} up>
          {external ? null : (
            <button
              onClick={() => {
                setMore(null);
                go("team");
              }}
              role="menuitem"
              type="button"
            >
              <Icon name="team" size="sm" />
              Equipe
            </button>
          )}
          <button
            onClick={() => {
              setMore(null);
              go("settings");
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="gear" size="sm" />
            Configurações
          </button>
          <button
            onClick={() => {
              setMore(null);
              setPrefs({
                theme: getPrefs().theme === "papel" ? "carvao" : "papel",
              });
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="moon" size="sm" />
            Alternar tema
          </button>
          <button
            onClick={() => {
              setMore(null);
              onLogout();
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="out" size="sm" />
            Sair
          </button>
        </Menu>
      )}
    </nav>
  );
}
