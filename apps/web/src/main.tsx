import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/bodoni-moda/600.css";
import {
  createApiClient,
  fetchCurrentAccount,
  login,
  logout,
  readCookie,
  type CurrentAccount,
} from "@oddkin/api-client";
import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type SessionState =
  | { status: "checking" }
  | { status: "anonymous" }
  | { status: "authenticated"; account: CurrentAccount }
  | { status: "unavailable" };

function KinMark({ small = false }: { small?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={small ? "kin-mark kin-mark--small" : "kin-mark"}
      viewBox="0 0 88 88"
    >
      <path
        d="M14 26h12V14h36v12h12v36H62v12H26V62H14V26Z"
        fill="currentColor"
      />
      <path d="M30 37h8v8h-8zm20 0h8v8h-8zM36 54h16v6H36z" fill="#f8f4e9" />
      <path d="M26 8h12v12H26zm24 0h12v12H50z" fill="#d76d4a" />
    </svg>
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

function Workspace({
  account,
  onLogout,
}: {
  account: CurrentAccount;
  onLogout: () => void;
}) {
  const client = useMemo(() => createApiClient(""), []);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");

  async function handleLogout() {
    const csrfToken = readCookie(document.cookie, "oddkin_csrf");
    if (csrfToken === null) {
      setError("Não foi possível encerrar a sessão.");
      return;
    }

    setLeaving(true);
    setError("");
    try {
      await logout(client, csrfToken);
      onLogout();
    } catch {
      setError("Não foi possível encerrar a sessão.");
      setLeaving(false);
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
          <a aria-current="page" href="#inicio">
            Início
          </a>
        </nav>
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
        <header>
          <p className="eyebrow">Seu espaço ODDKIN</p>
          <h1>O espaço está pronto.</h1>
          <p>
            A instalação e sua sessão estão funcionando. Os projetos chegam no
            próximo bloco.
          </p>
        </header>
        <div className="empty-board">
          <div className="empty-board__number">01</div>
          <div>
            <h2>Comece pelo que importa</h2>
            <p>
              Em breve, projetos, tarefas e conversas vão viver juntos aqui.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function App() {
  const client = useMemo(() => createApiClient(""), []);
  const [session, setSession] = useState<SessionState>({ status: "checking" });

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
    return (
      <Workspace
        account={session.account}
        onLogout={() => setSession({ status: "anonymous" })}
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
