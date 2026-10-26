import {
  createApiClient,
  listAvatars,
  logout,
  type CurrentAccount,
} from "@crewstead/api-client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { setAvatarVersions } from "../design/avatars";
import { useEvents } from "../events";
import { Banner } from "../design/primitives";
import { go, useRoute } from "../design/router";
import { useOptionalE2EE } from "../e2ee/E2EE";
import { csrfToken } from "../errors";
import { toast } from "../design/toast";
import { DeviceGate } from "../screens/Auth";
import { Chat } from "../screens/Chat";
import { Home } from "../screens/Home";
import { NewItem } from "../screens/NewItem";
import { Settings } from "../screens/Settings";
import { Sprints } from "../screens/Sprints";
import { Team } from "../screens/Team";
import { Work } from "../screens/Work";
import { InboxProvider } from "../inbox";
import { WorkspaceProvider } from "../workspace";
import { CallsProvider } from "./calls";
import { FocusHost } from "./focus";
import { SprintMilestones } from "./SprintMilestones";
import { StatsProvider } from "./stats";
import { ShellContext, type ShellApi } from "./context";
import { Palette } from "./Palette";
import { MobileNav, Sidebar } from "./Sidebar";
import { APP_NAME } from "../brand";

const TITLES = {
  home: "Visão geral",
  work: "Atividades",
  sprints: "Sprints",
  chat: "Mensagens",
  team: "Equipe",
  settings: "Configurações",
} as const;

function useOffline(): boolean {
  const [offline, setOffline] = useState(!navigator.onLine);
  const first = React.useRef(true);
  useEffect(() => {
    const on = () => {
      setOffline(false);
      if (!first.current)
        toast(
          "Reconectado. Deltas recuperados pelo cursor, sem lacunas nem duplicatas.",
          { icon: "rot" },
        );
    };
    const off = () => setOffline(true);
    first.current = false;
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return offline;
}

/** Keeps the list of visible profile photos fresh, here and when someone changes theirs. */
function AvatarSync() {
  const client = useMemo(() => createApiClient(""), []);
  const load = useCallback(() => {
    listAvatars(client)
      .then(setAvatarVersions)
      .catch(() => undefined);
  }, [client]);
  useEffect(load, [load]);
  useEvents((event) => {
    if (event === "resync" || event.eventType === "avatar.changed") load();
  });
  return null;
}

/** Tells whoever can approve devices that one is waiting, wherever they are in the app. */
function ApprovalNotice() {
  const e2ee = useOptionalE2EE();
  const route = useRoute();
  const waiting = e2ee?.approvals.length ?? 0;
  if (
    waiting === 0 ||
    (route.name === "settings" && route.arg === "dispositivos")
  )
    return null;
  return (
    <Banner
      icon="key"
      kind="warn"
      role="status"
      style={{ margin: "8px 32px 0" }}
    >
      <b>
        {waiting === 1
          ? "Um dispositivo pediu acesso ao histórico."
          : `${waiting} dispositivos pediram acesso ao histórico.`}
      </b>{" "}
      <button
        className="btn sm"
        onClick={() => go("settings/dispositivos")}
        type="button"
      >
        Revisar
      </button>
    </Banner>
  );
}

function Frame({
  account,
  onLogout,
}: {
  account: CurrentAccount;
  onLogout: () => void;
}) {
  const route = useRoute();
  const offline = useOffline();
  const [palette, setPalette] = useState(false);
  const [newItem, setNewItem] = useState<{ projectId?: string } | null>(null);
  const [gate, setGate] = useState(false);

  useEffect(() => {
    document.title = `${APP_NAME} · ${TITLES[route.name]}`;
  }, [route.name]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((value) => !value);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  const api = useMemo<ShellApi>(
    () => ({
      openPalette: () => setPalette(true),
      openNewItem: (projectId) =>
        setNewItem(projectId === undefined ? {} : { projectId }),
      openGate: () => setGate(true),
      offline,
    }),
    [offline],
  );

  // Moves to the activities screen when the account has no profile for the current one.
  useEffect(() => {
    if (route.name === "team" && account.membershipKind === "external")
      go("home");
  }, [route.name, account.membershipKind]);

  const screen = (() => {
    switch (route.name) {
      case "home":
        return <Home account={account} />;
      case "work":
        return <Work account={account} itemId={route.arg} />;
      case "sprints":
        return <Sprints account={account} />;
      case "chat":
        return <Chat account={account} conversationId={route.arg} />;
      case "team":
        return <Team account={account} />;
      case "settings":
        return (
          <Settings account={account} tab={route.arg} onLogout={onLogout} />
        );
    }
  })();

  return (
    <ShellContext.Provider value={api}>
      <AvatarSync />
      <SprintMilestones />
      <FocusHost />
      <div className="has-shell" id="app">
        <Sidebar account={account} onLogout={onLogout} />
        <div className="main" key={route.name}>
          <ApprovalNotice />
          {screen}
        </div>
        <MobileNav account={account} onLogout={onLogout} />
      </div>
      {gate ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 90,
            background: "var(--bg)",
          }}
        >
          <DeviceGate
            account={account}
            onContinue={() => setGate(false)}
            onLogout={onLogout}
          />
        </div>
      ) : null}
      {palette ? <Palette onClose={() => setPalette(false)} /> : null}
      {newItem === null ? null : (
        <NewItem
          onClose={() => setNewItem(null)}
          {...(newItem.projectId === undefined
            ? {}
            : { projectId: newItem.projectId })}
        />
      )}
    </ShellContext.Provider>
  );
}

export function Workspace({
  account,
  onLogout,
}: {
  account: CurrentAccount;
  onLogout: () => void;
}) {
  const e2ee = useOptionalE2EE();
  const client = useMemo(() => createApiClient(""), []);

  async function leave() {
    try {
      const token = csrfToken();
      // Keys are dropped from memory before the session ends.
      e2ee?.lock();
      await logout(client, token);
      onLogout();
    } catch {
      toast("Não foi possível encerrar a sessão.", { kind: "err" });
    }
  }

  return (
    <WorkspaceProvider account={account}>
      <InboxProvider>
        <CallsProvider>
          <StatsProvider accountId={account.id}>
            <Frame account={account} onLogout={() => void leave()} />
          </StatsProvider>
        </CallsProvider>
      </InboxProvider>
    </WorkspaceProvider>
  );
}
