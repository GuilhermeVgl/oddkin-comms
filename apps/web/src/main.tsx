import "@fontsource-variable/archivo/wdth.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/pixelify-sans/wght.css";
import "@fontsource-variable/schibsted-grotesk/wght.css";
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
import { OverviewArea } from "./Overview";
import { SprintsArea } from "./Sprints";
import "./styles.css";

type SessionState =
  | { status: "checking" }
  | { status: "anonymous" }
  | { status: "authenticated"; account: CurrentAccount }
  | { status: "unavailable" };

type PendingInvitation = { email: string; token: string };
type WorkspaceSection =
  "overview" | "activities" | "sprints" | "messages" | "team" | "security";
type IconName =
  | "home"
  | "board"
  | "flag"
  | "chat"
  | "team"
  | "settings"
  | "search"
  | "plus"
  | "chevron";

const WORKSPACE_SECTIONS: {
  id: WorkspaceSection;
  label: string;
  title: string;
  description: string;
  icon: IconName;
}[] = [
  {
    id: "overview",
    label: "Visão geral",
    title: "Visão geral",
    description: "O que importa para a equipe agora.",
    icon: "home",
  },
  {
    id: "activities",
    label: "Atividades",
    title: "Atividades",
    description: "Pequenos passos. Grandes entregas.",
    icon: "board",
  },
  {
    id: "sprints",
    label: "Sprints",
    title: "Sprints",
    description: "Dê ritmo às próximas entregas.",
    icon: "flag",
  },
  {
    id: "messages",
    label: "Conversas",
    title: "Conversas",
    description: "Fale com quem move o trabalho junto com você.",
    icon: "chat",
  },
  {
    id: "team",
    label: "Equipe",
    title: "Equipe",
    description: "Convide as próximas pessoas para a expedição.",
    icon: "team",
  },
  {
    id: "security",
    label: "Segurança",
    title: "Segurança",
    description: "Proteja o acesso e mantenha suas chaves sob seu controle.",
    icon: "settings",
  },
];

function Icon({ name }: { name: IconName }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
  };
  const path = {
    home: <path d="M3.5 10.5 12 3l8.5 7.5V21h-6v-6h-5v6h-6V10.5Z" />,
    board: (
      <>
        <rect height="16" rx="2" width="18" x="3" y="4" />
        <path d="M9 4v16m6-16v10" />
      </>
    ),
    flag: <path d="M5 21V4m0 1h12l-2.5 4L17 13H5" />,
    chat: (
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-5 4v-4.5a2.5 2.5 0 0 1-1-2v-8Z" />
    ),
    team: (
      <>
        <circle cx="9" cy="8" r="3" />
        <circle cx="17" cy="9" r="2.5" />
        <path d="M3.5 20c.3-4 2.1-6 5.5-6s5.2 2 5.5 6m0-5c3.6-.5 5.6 1.2 6 4" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19 13.5v-3l2-1.5-2-3.5-2.5 1A8 8 0 0 0 14 5l-.4-2.5h-4L9 5a8 8 0 0 0-2.5 1.5l-2.5-1L2 9l2 1.5v3L2 15l2 3.5 2.5-1A8 8 0 0 0 9 19l.5 2.5h4L14 19a8 8 0 0 0 2.5-1.5l2.5 1 2-3.5-2-1.5Z" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4.5 4.5" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    chevron: <path d="m8 10 4 4 4-4" />,
  }[name];
  return (
    <svg aria-hidden="true" className="ui-icon" viewBox="0 0 24 24" {...common}>
      {path}
    </svg>
  );
}

function accountName(email: string) {
  const local = email.split("@")[0]?.replace(/[._-]+/g, " ") ?? "equipe";
  return local.replace(/\b\p{L}/gu, (letter) =>
    letter.toLocaleUpperCase("pt-BR"),
  );
}

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
            <span>Pequenos passos.</span>
            <span>Grandes entregas.</span>
          </h1>
          <p>
            Organize o trabalho, mantenha todos por perto e transforme planos em
            progresso visível.
          </p>
        </div>
        <div aria-hidden="true" className="explorer-pair login-explorer">
          <span className="pixel-explorer pixel-explorer--bot" />
          <span className="pixel-explorer pixel-explorer--scout" />
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
            <span>Trabalho bom</span>
            <span>é trabalho junto.</span>
          </h1>
          <p>Confirme seu acesso e encontre a equipe no mesmo espaço.</p>
        </div>
        <div aria-hidden="true" className="explorer-pair login-explorer">
          <span className="pixel-explorer pixel-explorer--bot" />
          <span className="pixel-explorer pixel-explorer--scout" />
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
  const [activeSection, setActiveSection] =
    useState<WorkspaceSection>("overview");
  const section = WORKSPACE_SECTIONS.find(
    (entry) => entry.id === activeSection,
  )!;
  const displayName = accountName(account.email);
  const today = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  function openActivitySearch() {
    setActiveSection("activities");
    window.setTimeout(() =>
      document.getElementById("activity-search")?.focus(),
    );
  }

  function openTaskComposer() {
    setActiveSection("activities");
    window.setTimeout(() => document.getElementById("task-title")?.focus());
  }

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openActivitySearch();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

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
        <div className="organization-switcher">
          <span aria-hidden="true" className="organization-switcher__mark">
            O
          </span>
          <span>Oddkin Labs</span>
          <Icon name="chevron" />
        </div>
        <nav aria-label="Navegação principal">
          {WORKSPACE_SECTIONS.map((entry) => (
            <button
              aria-current={entry.id === activeSection ? "page" : undefined}
              key={entry.id}
              onClick={() => setActiveSection(entry.id)}
              type="button"
            >
              <Icon name={entry.icon} />
              <span>{entry.label}</span>
            </button>
          ))}
        </nav>
        <div aria-hidden="true" className="sidebar-explorers">
          <span className="pixel-explorer" />
        </div>
        <div className="account-block">
          <span aria-hidden="true" className="account-avatar">
            {displayName.charAt(0)}
          </span>
          <span className="account-block__identity">
            <strong>{displayName}</strong>
            <small>
              {account.isAdmin ? "Gestor · administrador" : account.email}
            </small>
          </span>
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

      <section className="workspace-content">
        <header className="workspace-header">
          <div>
            <h1>
              {activeSection === "overview"
                ? `Bom dia, ${displayName}`
                : section.title}
            </h1>
            <p>
              {activeSection === "overview"
                ? `${today.charAt(0).toUpperCase()}${today.slice(1)}.`
                : section.description}
            </p>
          </div>
          <div className="workspace-header__actions">
            <button
              aria-label="Buscar atividades"
              className="workspace-search"
              onClick={openActivitySearch}
              type="button"
            >
              <Icon name="search" />
              <span>Buscar atividades…</span>
              <kbd>Ctrl K</kbd>
            </button>
            <NotificationsPanel />
            <button
              className="workspace-create"
              onClick={openTaskComposer}
              type="button"
            >
              <Icon name="plus" />
              Nova atividade
            </button>
          </div>
        </header>
        {activeSection === "overview" ? (
          <OverviewArea
            account={account}
            onOpenActivities={() => setActiveSection("activities")}
          />
        ) : null}
        {activeSection === "activities" ? (
          <ProjectsArea account={account} onCelebrate={setCelebration} />
        ) : null}
        {activeSection === "sprints" ? (
          <div className="workspace-view">
            <SprintsArea account={account} onCelebrate={setCelebration} />
          </div>
        ) : null}
        {activeSection === "messages" ? (
          <div className="workspace-view workspace-view--messages">
            <ProjectsArea account={account} view="chat" />
            <DirectArea account={account} />
          </div>
        ) : null}
        {activeSection === "team" ? (
          <div className="workspace-view workspace-view--team">
            <ProjectsArea account={account} view="team" />
            {account.isAdmin ? (
              <section className="invite-panel" aria-labelledby="invite-title">
                <div>
                  <p className="eyebrow">Equipe</p>
                  <h2 id="invite-title">Convide alguém</h2>
                  <p>
                    O convite expira em sete dias e só pode ser usado pelo
                    e-mail informado.
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
            ) : (
              <p className="empty-note">
                Somente administradores podem convidar pessoas.
              </p>
            )}
          </div>
        ) : null}
        {activeSection === "security" ? (
          <div className="security-view">
            <SecurityPanel account={account} />
            <CallInvitations client={client} />
          </div>
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
