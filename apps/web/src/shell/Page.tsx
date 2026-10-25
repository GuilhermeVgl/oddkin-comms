import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../design/icons";
import { isReduced } from "../design/prefs";
import { Banner } from "../design/primitives";
import { useInbox } from "../inbox";
import { useShell } from "./context";
import { NotificationsMenu } from "./Notifications";

function Bell() {
  const { unreadNotifications, bellPulse } = useInbox();
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [wiggle, setWiggle] = useState(false);

  useEffect(() => {
    if (bellPulse === 0 || isReduced()) return;
    setWiggle(true);
    const timer = window.setTimeout(() => setWiggle(false), 700);
    return () => window.clearTimeout(timer);
  }, [bellPulse]);

  return (
    <>
      <button
        aria-label={`Notificações${unreadNotifications > 0 ? ", há novas" : ""}`}
        className={`iconbtn${wiggle ? " wig" : ""}`}
        id="bell"
        onClick={() => setOpen((value) => !value)}
        ref={button}
        type="button"
      >
        <Icon name="bell" />
        {unreadNotifications > 0 ? <i className="pip" /> : null}
      </button>
      {open && button.current !== null ? (
        <NotificationsMenu
          anchor={button.current}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/** One screen: title bar (search, bell, main action) and the scrolling view. */
export function Page({
  title,
  sub,
  placeholder = "Buscar…",
  cta,
  flush = false,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  placeholder?: string;
  cta?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}) {
  const { openPalette, offline } = useShell();
  return (
    <>
      <div className="top" id="top">
        <div className="ttl">
          <h1>{title}</h1>
          {sub === undefined ? null : <p className="sub">{sub}</p>}
        </div>
        <button
          aria-label="Buscar (Ctrl K)"
          className="search"
          onClick={openPalette}
          type="button"
        >
          <Icon name="search" />
          <span>{placeholder}</span>
          <kbd>Ctrl K</kbd>
        </button>
        <Bell />
        {cta}
      </div>
      <div id="banners">
        {offline ? (
          <Banner kind="warn" role="alert" style={{ margin: "0 32px 8px" }}>
            <b>Sem conexão.</b> O que você já sincronizou continua legível, mas
            alterações exigem conexão. Seus rascunhos ficam protegidos neste
            dispositivo.
            <span
              aria-hidden="true"
              className="typing"
              style={{ marginLeft: 8 }}
            >
              <i />
              <i />
              <i />
            </span>
          </Banner>
        ) : null}
      </div>
      <main className={`view${flush ? " flush" : ""}`} id="view">
        {children}
      </main>
    </>
  );
}
