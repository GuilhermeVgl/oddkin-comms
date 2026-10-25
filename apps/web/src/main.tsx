import {
  createApiClient,
  fetchCurrentAccount,
  logout,
  readCookie,
  type CurrentAccount,
} from "@oddkin/api-client";
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
import "./styles.css";

type SessionState =
  | { status: "checking" }
  | { status: "anonymous" }
  | { status: "authenticated"; account: CurrentAccount }
  | { status: "unavailable" };

type Entry =
  | { kind: "invitation"; invitation: PendingInvitation }
  | { kind: "reset"; token: string }
  | null;

/** Links from e-mails carry a one-time token in the hash; read it once and clear it. */
function readEntry(): Entry {
  const hash = window.location.hash;
  const invitation = /^#accept-invitation\?(.*)$/.exec(hash);
  if (invitation !== null) {
    const params = new URLSearchParams(invitation[1]);
    const email = params.get("email");
    const token = params.get("token");
    if (email !== null && token !== null && token.length === 43) {
      return { kind: "invitation", invitation: { email, token } };
    }
    return null;
  }
  const reset = /^#reset-password\?(.*)$/.exec(hash);
  if (reset !== null) {
    const token = new URLSearchParams(reset[1]).get("token");
    if (token !== null && token.length === 43) return { kind: "reset", token };
  }
  return null;
}

const SKIP_KEY = "oddkin.gate.skipped";

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
    const token = readCookie(document.cookie, "oddkin_csrf");
    e2ee?.lock();
    if (token !== null) await logout(client, token).catch(() => undefined);
    onLogout();
  }

  if (phase === "loading")
    return <StatusScreen title="Preparando seu espaço…" />;
  const needsGate =
    phase === "needs_device" ||
    phase === "pending_approval" ||
    phase === "locked" ||
    phase === "revoked" ||
    phase === "error" ||
    (phase === "not_configured" && account.isAdmin);
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
  return <Workspace account={account} onLogout={onLogout} />;
}

function App() {
  const client = useMemo(() => createApiClient(""), []);
  const [session, setSession] = useState<SessionState>({ status: "checking" });
  const [entry, setEntry] = useState<Entry>(readEntry);
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
  if (session.status === "checking") {
    screen = <StatusScreen title="Preparando seu espaço…" />;
  } else if (session.status === "unavailable") {
    screen = (
      <StatusScreen title="Não foi possível abrir o ODDKIN.">
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
          onSignIn={() => setSigningIn(true)}
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
  } else if (entry?.kind === "reset") {
    screen = (
      <ResetPasswordScreen onDone={() => setEntry(null)} token={entry.token} />
    );
  } else if (entry?.kind === "invitation" && !signingIn) {
    screen = (
      <InvitationScreen
        invitation={entry.invitation}
        onAccepted={(account) => {
          setEntry(null);
          setSession({ status: "authenticated", account });
        }}
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

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
