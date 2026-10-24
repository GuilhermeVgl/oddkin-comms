import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/bodoni-moda/600.css";
import {
  acceptInvitation,
  createApiClient,
  createInvitation,
  fetchCurrentAccount,
  login,
  logout,
  readCookie,
  type CurrentAccount,
  type MembershipKind,
} from "@oddkin/api-client";
import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ProjectsArea } from "./Projects";
import { CallInvitations } from "./Calls";
import { DirectArea, NotificationsPanel } from "./Direct";
import { E2EEProvider, useOptionalE2EE } from "./e2ee/E2EE";
import { SecurityPanel } from "./e2ee/Security";
import { EventsProvider } from "./events";
import { SprintsArea } from "./Sprints";
import "./styles.css";

type SessionState =
  | { status: "checking" }
  | { status: "anonymous" }
  | { status: "authenticated"; account: CurrentAccount }
  | { status: "unavailable" };

type PendingInvitation = { email: string; token: string };

function readInvitationHash(): PendingInvitation | null {
  const match = /^#accept-invitation\?(.*)$/.exec(window.location.hash);
  if (match === null) return null;
  const params = new URLSearchParams(match[1]);
  const email = params.get("email");
  const token = params.get("token");
  if (email === null || token === null || token.length !== 43) return null;
  return { email, token };
}

function KinMark({ small = false }: { small?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={small ? "kin-mark kin-mark--small" : "kin-mark"}
      viewBox="0 0 88 88"
    >
      <path
        d="M14 76V31C14 17 25 8 39 8h10v18H39c-4 0-7 3-7 7v43H14Zm42 0V33c0-4-3-7-7-7H39V8h10c14 0 25 9 25 23v45H56Z"
        fill="currentColor"
      />
      <path
        d="M32 76V42c0-9 7-16 16-16s16 7 16 16v34H48V44c0-1-1-2-2-2s-2 1-2 2v32H32Z"
        fill="currentColor"
      />
    </svg>
  );
}

function Celebration({
  title,
  onDismiss,
}: {
  title: string;
  onDismiss: () => void;
}) {
  return (
    <div className="completion-celebration" role="status">
      <div className="completion-celebration__panel">
        <div aria-hidden="true" className="celebration-sparks">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div
          aria-hidden="true"
          className="explorer-pair explorer-pair--celebrate"
        >
          <span className="pixel-explorer pixel-explorer--bot" />
          <span className="pixel-explorer pixel-explorer--scout" />
        </div>
        <div>
          <strong>{title}</strong>
          <p>Pequenos passos contam.</p>
        </div>
        <button
          aria-label="Fechar celebração"
          onClick={onDismiss}
          type="button"
        >
          Fechar
        </button>
      </div>
    </div>
  );
}

function LoginScreen({
  onLogin,
}: {
  onLogin: (account: CurrentAccount) => void;
}) {
  const client = useMemo(() => createApiClient(""), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const result = await login(client, email, password);
      if (result === "invalid-credentials") {
        setError("E-mail ou senha incorretos.");
        return;
      }
      if (result === "rate-limited") {
        setError("Muitas tentativas. Aguarde um pouco e tente novamente.");
        return;
      }
      if (result === "unavailable") {
        setError("O serviço está temporariamente indisponível.");
        return;
      }

      const account = await fetchCurrentAccount(client);
      if (account === null) {
        setError("Não foi possível iniciar sua sessão.");
        return;
      }
      onLogin(account);
    } catch {
      setError("Não foi possível conectar ao ODDKIN.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-layout">
      <section className="brand-panel" aria-labelledby="brand-title">
        <div className="brand-lockup">
          <KinMark />
          <span>ODDKIN</span>
        </div>
        <div className="brand-message">
          <p className="eyebrow">Um espaço para fazer junto</p>
          <h1 id="brand-title">
            Pequenos passos.
            <br />
            Grandes entregas.
          </h1>
          <p>
            Organize o trabalho, mantenha todos por perto e transforme planos em
            progresso visível.
          </p>
        </div>
        <p className="brand-footnote">Comunicação com ritmo humano.</p>
      </section>

      <section className="login-panel" aria-labelledby="login-title">
        <div className="mobile-brand">
          <KinMark small />
          <span>ODDKIN</span>
        </div>
        <div className="login-card">
          <p className="eyebrow">Bem-vindo de volta</p>
          <h2 id="login-title">Entre no seu espaço</h2>
          <p className="login-intro">
            Use as credenciais configuradas na instalação.
          </p>

          <form onSubmit={handleSubmit}>
            <label htmlFor="email">E-mail</label>
            <input
              autoComplete="email"
              id="email"
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="voce@empresa.com"
              required
              type="email"
              value={email}
            />

            <label htmlFor="password">Senha</label>
            <input
              autoComplete="current-password"
              id="password"
              minLength={12}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />

            <p aria-live="polite" className="form-message">
              {error}
            </p>
            <button disabled={submitting} type="submit">
              {submitting ? "Entrando…" : "Entrar"}
            </button>
          </form>
        </div>
        <p className="login-note">
          Sua sessão fica protegida neste dispositivo.
        </p>
      </section>
    </main>
  );
}

function InvitationScreen({
  invitation,
  account,
  onAccepted,
  onSignIn,
}: {
  invitation: PendingInvitation;
  account?: CurrentAccount;
  onAccepted: (account: CurrentAccount) => void;
  onSignIn: () => void;
}) {
  const client = useMemo(() => createApiClient(""), []);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const accountMatches =
    account === undefined || account.email === invitation.email;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accountMatches) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await acceptInvitation(
        client,
        invitation.token,
        invitation.email,
        account === undefined ? password : undefined,
      );
      if (result === "invalid") {
        setError(
          "O convite não é válido, já foi usado ou pertence a outra conta.",
        );
        return;
      }
      if (result === "unavailable") {
        setError("O serviço está temporariamente indisponível.");
        return;
      }

      if (account !== undefined) {
        onAccepted(account);
        return;
      }
      const loginResult = await login(client, invitation.email, password);
      if (loginResult !== "authenticated") {
        setError("Convite aceito. Entre com a senha que você acabou de criar.");
        onSignIn();
        return;
      }
      const current = await fetchCurrentAccount(client);
      if (current === null) throw new Error("session not created");
      onAccepted(current);
    } catch {
      setError("Não foi possível aceitar o convite.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-layout">
      <section className="brand-panel" aria-labelledby="invitation-brand-title">
        <div className="brand-lockup">
          <KinMark />
          <span>ODDKIN</span>
        </div>
        <div className="brand-message">
          <p className="eyebrow">Você foi convidado</p>
          <h1 id="invitation-brand-title">
            Trabalho bom
            <br />é trabalho junto.
          </h1>
          <p>Confirme seu acesso e encontre a equipe no mesmo espaço.</p>
        </div>
        <p className="brand-footnote">Um convite. Um começo compartilhado.</p>
      </section>
      <section className="login-panel" aria-labelledby="invitation-title">
        <div className="mobile-brand">
          <KinMark small />
          <span>ODDKIN</span>
        </div>
        <div className="login-card">
          <p className="eyebrow">Convite para a equipe</p>
          <h2 id="invitation-title">Aceite seu convite</h2>
          <p className="login-intro">
            O acesso foi enviado para <strong>{invitation.email}</strong>.
          </p>
          <form onSubmit={handleSubmit}>
            {account === undefined ? (
              <>
                <label htmlFor="new-password">Crie uma senha</label>
                <input
                  autoComplete="new-password"
                  id="new-password"
                  minLength={12}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
              </>
            ) : null}
            {!accountMatches ? (
              <p className="form-message">
                Você está conectado como {account?.email}. Entre com a conta do
                convite.
              </p>
            ) : null}
            <p aria-live="polite" className="form-message">
              {error}
            </p>
            <button disabled={submitting || !accountMatches} type="submit">
              {submitting ? "Aceitando…" : "Aceitar convite"}
            </button>
            {account === undefined ? (
              <button
                className="secondary-button"
                onClick={onSignIn}
                type="button"
              >
                Já tenho uma conta
              </button>
            ) : null}
          </form>
        </div>
      </section>
    </main>
  );
}

function Workspace({
  account,
  onLogout,
}: {
  account: CurrentAccount;
  onLogout: () => void;
}) {
  const client = useMemo(() => createApiClient(""), []);
  const e2ee = useOptionalE2EE();
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteKind, setInviteKind] = useState<MembershipKind>("internal");
  const [inviting, setInviting] = useState(false);
  const [inviteMessage, setInviteMessage] = useState("");
  const [celebration, setCelebration] = useState<string | null>(null);

  async function handleLogout() {
    const csrfToken = readCookie(document.cookie, "oddkin_csrf");
    if (csrfToken === null) {
      setError("Não foi possível encerrar a sessão.");
      return;
    }

    setLeaving(true);
    setError("");
    // Keys are dropped from memory before the session ends.
    e2ee?.lock();
    try {
      await logout(client, csrfToken);
      onLogout();
    } catch {
      setError("Não foi possível encerrar a sessão.");
      setLeaving(false);
    }
  }

  async function handleInvitation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const csrfToken = readCookie(document.cookie, "oddkin_csrf");
    if (csrfToken === null) {
      setInviteMessage("Sua sessão precisa ser renovada.");
      return;
    }
    setInviting(true);
    setInviteMessage("");
    try {
      await createInvitation(client, inviteEmail, inviteKind, csrfToken);
      setInviteEmail("");
      setInviteMessage("Convite criado e enfileirado para entrega.");
    } catch {
      setInviteMessage("Não foi possível criar o convite.");
    } finally {
      setInviting(false);
    }
  }

  return (
    <main className="workspace-shell">
      <aside className="workspace-sidebar">
        <div className="brand-lockup brand-lockup--sidebar">
          <KinMark small />
          <span>ODDKIN</span>
        </div>
        <nav aria-label="Navegação principal">
          <a href="#inicio">Visão geral</a>
          <a aria-current="page" href="#atividades">
            Atividades
          </a>
          <a href="#sprints">Sprints</a>
          <a href="#conversas">Conversas</a>
          <a href="#seguranca">Segurança</a>
        </nav>
        <NotificationsPanel />
        <div id="seguranca">
          <SecurityPanel account={account} />
        </div>
        <CallInvitations client={client} />
        <div className="account-block">
          <span>Sessão ativa</span>
          <strong>{account.email}</strong>
          <button
            className="text-button"
            disabled={leaving}
            onClick={handleLogout}
            type="button"
          >
            {leaving ? "Saindo…" : "Sair"}
          </button>
          <p aria-live="polite" className="logout-error">
            {error}
          </p>
        </div>
      </aside>

      <section className="workspace-content" id="inicio">
        <header className="workspace-header">
          <div>
            <h1>Atividades</h1>
            <p>Pequenos passos. Grandes entregas.</p>
          </div>
          <div
            aria-hidden="true"
            className="explorer-pair explorer-pair--header"
          >
            <span className="pixel-explorer pixel-explorer--bot" />
            <span className="pixel-explorer pixel-explorer--scout" />
          </div>
        </header>
        <ProjectsArea account={account} onCelebrate={setCelebration} />
        <div id="sprints">
          <SprintsArea account={account} />
        </div>
        <div id="conversas">
          <DirectArea account={account} />
        </div>
        {account.isAdmin ? (
          <section className="invite-panel" aria-labelledby="invite-title">
            <div>
              <p className="eyebrow">Equipe</p>
              <h2 id="invite-title">Convide alguém</h2>
              <p>
                O convite expira em sete dias e só pode ser usado pelo e-mail
                informado.
              </p>
            </div>
            <form onSubmit={handleInvitation}>
              <label htmlFor="invite-email">E-mail</label>
              <input
                id="invite-email"
                type="email"
                required
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="pessoa@empresa.com"
              />
              <label htmlFor="invite-kind">Tipo de acesso</label>
              <select
                id="invite-kind"
                value={inviteKind}
                onChange={(event) =>
                  setInviteKind(event.target.value as MembershipKind)
                }
              >
                <option value="internal">Membro interno</option>
                <option value="external">Colaborador externo</option>
              </select>
              <button disabled={inviting} type="submit">
                {inviting ? "Criando…" : "Criar convite"}
              </button>
              <p aria-live="polite" className="invite-message">
                {inviteMessage}
              </p>
            </form>
          </section>
        ) : null}
      </section>
      {celebration !== null ? (
        <Celebration
          onDismiss={() => setCelebration(null)}
          title={celebration}
        />
      ) : null}
    </main>
  );
}

function App() {
  const client = useMemo(() => createApiClient(""), []);
  const [session, setSession] = useState<SessionState>({ status: "checking" });
  const [invitation, setInvitation] = useState<PendingInvitation | null>(() =>
    readInvitationHash(),
  );
  const [signingIntoInvitation, setSigningIntoInvitation] = useState(false);

  useEffect(() => {
    if (invitation !== null) {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    }
  }, [invitation]);

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

  if (session.status === "checking") {
    return (
      <main className="status-screen">
        <KinMark />
        <p>Preparando seu espaço…</p>
      </main>
    );
  }

  if (session.status === "unavailable") {
    return (
      <main className="status-screen">
        <KinMark />
        <h1>Não foi possível abrir o ODDKIN.</h1>
        <p>Confira se os serviços estão ativos e recarregue a página.</p>
      </main>
    );
  }

  if (session.status === "authenticated") {
    if (invitation !== null) {
      return (
        <InvitationScreen
          account={session.account}
          invitation={invitation}
          onAccepted={(account) => {
            setInvitation(null);
            setSession({ status: "authenticated", account });
          }}
          onSignIn={() => setSigningIntoInvitation(true)}
        />
      );
    }
    return (
      <EventsProvider>
        <E2EEProvider account={session.account}>
          <Workspace
            account={session.account}
            onLogout={() => setSession({ status: "anonymous" })}
          />
        </E2EEProvider>
      </EventsProvider>
    );
  }

  if (invitation !== null && !signingIntoInvitation) {
    return (
      <InvitationScreen
        invitation={invitation}
        onAccepted={(account) => {
          setInvitation(null);
          setSession({ status: "authenticated", account });
        }}
        onSignIn={() => setSigningIntoInvitation(true)}
      />
    );
  }

  return (
    <LoginScreen
      onLogin={(account) => setSession({ status: "authenticated", account })}
    />
  );
}

const root = document.getElementById("root");
if (root === null) throw new Error("Root element is missing");

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
