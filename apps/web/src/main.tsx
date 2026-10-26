import {
  createApiClient,
  fetchCurrentAccount,
  logout,
  type CurrentAccount,
} from "@crewstead/api-client";
import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { FinaleHost } from "./design/celebrate";
import { ConfirmHost } from "./design/confirm";
import { go } from "./design/router";
import { ToastHost } from "./design/toast";
import { E2EEProvider, useOptionalE2EE } from "./e2ee/E2EE";
import { EventsProvider } from "./events";
import {
  DeviceGate,
  InvitationScreen,
  LoginScreen,
  ResetPasswordScreen,
  StatusScreen,
  type PendingInvitation,
} from "./screens/Auth";
import { Workspace } from "./shell/Shell";
import { OrganizationGate } from "./organization";
import "./styles.css";
import { APP_NAME } from "./brand";

type SessionState =
  | { status: "checking" }
  | { status: "anonymous" }
  | { status: "authenticated"; account: CurrentAccount }
  | { status: "unavailable" };

type Entry =
  | { kind: "invitation"; invitation: PendingInvitation }
  | { kind: "reset"; token: string }
  | null;

const ENTRY_KEY = "crewstead.pending-entry";

/**
 * The link's token leaves the address bar as soon as it is read, so it is kept
 * for this tab until it is used: a reload on the invitation screen must not
 * lose it. Cleared the moment the invitation is accepted or the reset is done.
 */
function rememberEntry(entry: Entry): void {
  try {
    if (entry === null) window.sessionStorage.removeItem(ENTRY_KEY);
    else window.sessionStorage.setItem(ENTRY_KEY, JSON.stringify(entry));
  } catch {
    // Without storage a reload loses the link; the e-mail still has it.
  }
}

function storedEntry(): Entry {
  try {
    const raw = window.sessionStorage.getItem(ENTRY_KEY);
    if (raw === null) return null;
    const value = JSON.parse(raw) as Entry;
    if (
      value?.kind === "invitation" &&
      typeof value.invitation?.token === "string"
    )
      return value;
    if (value?.kind === "reset" && typeof value.token === "string")
      return value;
  } catch {
    // Unreadable: treat as absent.
  }
  return null;
}

/** Links from e-mails carry a one-time token in the hash; read it once and keep it until used. */
function readEntry(): Entry {
  const hash = window.location.hash;
  const invitation = /^#accept-invitation\?(.*)$/.exec(hash);
  if (invitation !== null) {
    const params = new URLSearchParams(invitation[1]);
    const email = params.get("email");
    const token = params.get("token");
    const historyKey = params.get("k");
    const rootFingerprint = params.get("rf");
    if (email !== null && token !== null && token.length === 43) {
      const entry: Entry = {
        kind: "invitation",
        invitation: {
          email,
          token,
          ...(historyKey !== null && rootFingerprint !== null
            ? { historyKey, rootFingerprint }
            : {}),
        },
      };
      rememberEntry(entry);
      return entry;
    }
    return storedEntry();
  }
  const reset = /^#reset-password\?(.*)$/.exec(hash);
  if (reset !== null) {
    const token = new URLSearchParams(reset[1]).get("token");
    if (token !== null && token.length === 43) {
      const entry: Entry = { kind: "reset", token };
      rememberEntry(entry);
      return entry;
    }
    return storedEntry();
  }
  return storedEntry();
}

const SKIP_KEY = "crewstead.gate.skipped";

function gateSkipped(accountId: string): boolean {
  try {
    return window.sessionStorage.getItem(SKIP_KEY) === accountId;
  } catch {
    return false;
  }
}

/** Signed in: decides between the security step and the workspace itself. */
function Authenticated({
  account,
  onLogout,
}: {
  account: CurrentAccount;
  onLogout: () => void;
}) {
  const e2ee = useOptionalE2EE();
  const client = useMemo(() => createApiClient(""), []);
  const [skipped, setSkipped] = useState(() => gateSkipped(account.id));
  const phase = e2ee?.phase ?? "unlocked";

  async function leave() {
    e2ee?.lock();
    await logout(client).catch(() => undefined);
    onLogout();
  }

  if (phase === "loading")
    return <StatusScreen title="Preparando seu espaço…" />;
  // Invited with history, the browser sets itself up; invited without, the
  // person is never asked. Neither sees the key step.
  const needsGate =
    !(e2ee?.autoManaged === true && phase !== "error" && phase !== "revoked") &&
    phase !== "not_enabled" &&
    (phase === "needs_device" ||
      phase === "pending_approval" ||
      phase === "locked" ||
      phase === "revoked" ||
      phase === "error" ||
      (phase === "not_configured" && account.isAdmin));
  if (needsGate && !skipped) {
    return (
      <DeviceGate
        account={account}
        onContinue={() => {
          try {
            window.sessionStorage.setItem(SKIP_KEY, account.id);
          } catch {
            // The step then shows again after a reload.
          }
          setSkipped(true);
        }}
        onLogout={() => void leave()}
      />
    );
  }
  return (
    <OrganizationGate account={account}>
      <Workspace account={account} onLogout={onLogout} />
    </OrganizationGate>
  );
}

function App() {
  const client = useMemo(() => createApiClient(""), []);
  const [session, setSession] = useState<SessionState>({ status: "checking" });
  const [entry, setEntryState] = useState<Entry>(readEntry);
  const setEntry = (next: Entry) => {
    rememberEntry(next);
    setEntryState(next);
  };
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    if (entry !== null) {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    }
  }, [entry]);

  useEffect(() => {
    let active = true;
    fetchCurrentAccount(client)
      .then((account) => {
        if (active) {
          setSession(
            account === null
              ? { status: "anonymous" }
              : { status: "authenticated", account },
          );
        }
      })
      .catch(() => {
        if (active) setSession({ status: "unavailable" });
      });
    return () => {
      active = false;
    };
  }, [client]);

  let screen: React.ReactNode;
  if (entry?.kind === "reset" && session.status !== "checking") {
    // A reset ends every session, so whoever was signed in signs in again afterwards.
    screen = (
      <ResetPasswordScreen
        onDone={() => {
          setEntry(null);
          setSession({ status: "anonymous" });
        }}
        token={entry.token}
      />
    );
  } else if (session.status === "checking") {
    screen = <StatusScreen title="Preparando seu espaço…" />;
  } else if (session.status === "unavailable") {
    screen = (
      <StatusScreen title={`Não foi possível abrir o ${APP_NAME}.`}>
        <p className="muted">
          Confira se os serviços estão ativos e recarregue a página.
        </p>
      </StatusScreen>
    );
  } else if (session.status === "authenticated") {
    if (entry?.kind === "invitation") {
      screen = (
        <InvitationScreen
          account={session.account}
          invitation={entry.invitation}
          onAccepted={(account) => {
            setEntry(null);
            setSession({ status: "authenticated", account });
          }}
          onConsumed={() => setEntry(null)}
          onSignIn={() => setSigningIn(true)}
          onSwitchAccount={() => {
            void logout(client)
              .catch(() => undefined)
              .then(() => setSession({ status: "anonymous" }));
          }}
        />
      );
    } else {
      screen = (
        <EventsProvider>
          <E2EEProvider account={session.account}>
            <Authenticated
              account={session.account}
              onLogout={() => {
                go("home");
                setSession({ status: "anonymous" });
              }}
            />
          </E2EEProvider>
        </EventsProvider>
      );
    }
  } else if (entry?.kind === "invitation" && !signingIn) {
    screen = (
      <InvitationScreen
        invitation={entry.invitation}
        onAccepted={(account) => {
          setEntry(null);
          setSession({ status: "authenticated", account });
        }}
        onConsumed={() => setEntry(null)}
        onSignIn={() => setSigningIn(true)}
      />
    );
  } else {
    screen = (
      <LoginScreen
        onInvitation={(invitation) => {
          setSigningIn(false);
          setEntry({ kind: "invitation", invitation });
        }}
        onLogin={(account) => setSession({ status: "authenticated", account })}
      />
    );
  }

  return (
    <>
      {screen}
      <ToastHost />
      <ConfirmHost />
      <FinaleHost />
    </>
  );
}

const root = document.getElementById("root");
if (root === null) throw new Error("Root element is missing");
document.title = `${APP_NAME} · Pequenos passos. Grandes entregas.`;
document
  .querySelector('meta[name="description"]')
  ?.setAttribute("content", `${APP_NAME} — pequenos passos, grandes entregas.`);

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
