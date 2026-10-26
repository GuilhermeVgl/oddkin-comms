import {
  acceptInvitation,
  confirmPasswordReset,
  createApiClient,
  fetchCurrentAccount,
  login,
  requestPasswordReset,
  type CurrentAccount,
} from "@crewstead/api-client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Icon, Logo } from "../design/icons";
import { Modal } from "../design/Modal";
import { isReduced } from "../design/prefs";
import { Banner } from "../design/primitives";
import { Duo, Sprite, type DuoRef } from "../design/Sprite";
import { blip } from "../design/sound";
import { toast } from "../design/toast";
import { APP_NAME } from "../brand";
import { useDuoVisible } from "../design/duoVisibility";
import { useE2EE } from "../e2ee/E2EE";

const MIN_PASSWORD = 12;

export type PendingInvitation = { email: string; token: string };

/** Types a line out one letter at a time (instantly when motion is reduced). */
function Typewriter({ text, speed = 28 }: { text: string; speed?: number }) {
  const [shown, setShown] = useState(isReduced() ? text : "");
  useEffect(() => {
    if (isReduced()) {
      setShown(text);
      return;
    }
    setShown("");
    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setShown(text.slice(0, index));
      if (index >= text.length) window.clearInterval(timer);
    }, speed);
    return () => window.clearInterval(timer);
  }, [text, speed]);
  return <>{shown}</>;
}

const LINES = [
  "Pequenos passos. Grandes entregas.",
  "Criar. Testar. Repetir.",
  "Bem-vinda(o) de volta.",
];

function LoginArt({ duo }: { duo: React.RefObject<DuoRef | null> }) {
  const showDuo = useDuoVisible();
  const [line, setLine] = useState(0);
  useEffect(() => {
    if (!showDuo) return;
    const timer = window.setInterval(() => {
      setLine((value) => {
        const next = (value + 1) % LINES.length;
        duo.current?.set(next === 1 ? "think" : next === 2 ? "wave" : "idle");
        return next;
      });
    }, 3800);
    return () => window.clearInterval(timer);
  }, [duo, showDuo]);
  return (
    <section aria-hidden="false" className="login-art">
      <div className="brand" style={{ padding: 0, color: "var(--papel)" }}>
        <Logo />
        <span>{APP_NAME}</span>
      </div>
      {showDuo ? (
        <div>
          <div className="pdlg" style={{ marginBottom: 18, maxWidth: 320 }}>
            <span id="lt">
              <Typewriter text={LINES[line] ?? ""} />
            </span>
          </div>
          <div
            className="stage-px"
            style={{
              animation: isReduced() ? "none" : "rise 600ms var(--ease)",
            }}
          >
            <div className="floor" />
            <Duo gap={24} pose="idle" ref={duo} scale={6} />
          </div>
        </div>
      ) : null}
      <h2>
        Pequenos passos.
        <br />
        <em>Grandes entregas.</em>
      </h2>
    </section>
  );
}

function ForgotDialog({ onClose }: { onClose: () => void }) {
  const client = useMemo(() => createApiClient(""), []);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal onClose={onClose}>
      <div className="dh">
        <h2 id="dlgt">Redefinir senha</h2>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          requestPasswordReset(client, email)
            .then((result) => {
              onClose();
              if (result === "accepted") {
                toast("Se existir uma conta, o link foi enviado.", {
                  icon: "mail",
                });
              } else {
                toast(
                  result === "rate-limited"
                    ? "Muitas tentativas. Aguarde um instante."
                    : "O envio de e-mails não está disponível agora.",
                  { kind: "err" },
                );
              }
            })
            .catch(() => {
              setBusy(false);
              toast("Não foi possível pedir o link agora.", { kind: "err" });
            });
        }}
      >
        <div className="dbd col gap12">
          <p className="muted">
            Enviaremos um link de uso único, válido por uma hora. A resposta é a
            mesma para qualquer e-mail, assim ninguém descobre quem tem conta.
          </p>
          <div className="field">
            <label htmlFor="fe">E-mail</label>
            <input
              autoComplete="username"
              className="inp"
              id="fe"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </div>
          <Banner>
            Redefinir a senha <b>não restaura o histórico cifrado</b>. Depois,
            este dispositivo ainda precisa ser liberado.
          </Banner>
        </div>
        <div className="dft">
          <button className="btn" onClick={onClose} type="button">
            Cancelar
          </button>
          <button
            className={`btn primary${busy ? " loading" : ""}`}
            type="submit"
          >
            Enviar link
          </button>
        </div>
      </form>
    </Modal>
  );
}

function InviteDialog({
  onClose,
  onOpen,
}: {
  onClose: () => void;
  onOpen: (invitation: PendingInvitation) => void;
}) {
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState(false);
  return (
    <Modal onClose={onClose}>
      <div className="dh">
        <h2 id="dlgt">Aceitar convite</h2>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          // The e-mail link carries both values; a pasted link works as well as the code.
          const pasted = /[?&]token=([A-Za-z0-9_-]{43})/.exec(code);
          const token = pasted?.[1] ?? code.trim();
          if (token.length !== 43 || !/^\S+@\S+\.\S+$/.test(email.trim())) {
            setError(true);
            blip("err");
            return;
          }
          onClose();
          onOpen({ email: email.trim(), token });
        }}
      >
        <div className="dbd col gap12">
          <div className="field">
            <label htmlFor="iv">Código do convite</label>
            <input
              autoComplete="off"
              className="inp mono"
              id="iv"
              onChange={(event) => setCode(event.target.value)}
              placeholder="Cole o código ou o link recebido"
              value={code}
            />
          </div>
          <div className="field">
            <label htmlFor="ie">Seu e-mail</label>
            <input
              className="inp"
              id="ie"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="voce@empresa.com"
              type="email"
              value={email}
            />
          </div>
          {error ? (
            <Banner kind="err" role="alert">
              <b>Não foi possível usar este convite.</b> Confira o código e o
              e-mail. Ele pode ter expirado, já ter sido usado ou pertencer a
              outro e-mail. Peça um novo convite a quem convidou você.
            </Banner>
          ) : null}
        </div>
        <div className="dft">
          <button className="btn" onClick={onClose} type="button">
            Cancelar
          </button>
          <button className="btn primary" type="submit">
            Validar
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function LoginScreen({
  onLogin,
  onInvitation,
}: {
  onLogin: (account: CurrentAccount) => void;
  onInvitation: (invitation: PendingInvitation) => void;
}) {
  const client = useMemo(() => createApiClient(""), []);
  const duo = useRef<DuoRef>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{
    kind: "err" | "warn";
    text: string;
  } | null>(null);
  const [dialog, setDialog] = useState<"forgot" | "invite" | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    duo.current?.set("load");
    try {
      const result = await login(client, email, password);
      if (result !== "authenticated") {
        duo.current?.set("oops", 1200);
        blip("err");
        setError(
          result === "rate-limited"
            ? {
                kind: "warn",
                text: "Muitas tentativas. Aguarde um instante antes de tentar de novo.",
              }
            : result === "unavailable"
              ? {
                  kind: "warn",
                  text: "O serviço está temporariamente indisponível.",
                }
              : {
                  kind: "err",
                  text: "E-mail ou senha incorretos. Confira os dados e tente de novo.",
                },
        );
        return;
      }
      const account = await fetchCurrentAccount(client);
      if (account === null) {
        setError({ kind: "err", text: "Não foi possível iniciar sua sessão." });
        return;
      }
      onLogin(account);
    } catch {
      duo.current?.set("oops", 1200);
      setError({
        kind: "err",
        text: `Não foi possível conectar ao ${APP_NAME}.`,
      });
    } finally {
      setBusy(false);
      duo.current?.set("idle");
    }
  }

  return (
    <div id="app">
      <div className="login">
        <LoginArt duo={duo} />
        <section className="login-form">
          <div>
            <h1>Entrar</h1>
            <p className="muted" style={{ marginTop: 6 }}>
              Acesso por convite. Sua equipe, seus projetos, tudo cifrado de
              ponta a ponta.
            </p>
          </div>
          <form
            className="col gap16"
            noValidate
            onSubmit={(event) => void submit(event)}
          >
            <div className="field">
              <label htmlFor="em">E-mail</label>
              <input
                autoComplete="username"
                className="inp"
                id="em"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </div>
            <div className="field">
              <label htmlFor="pw">Senha</label>
              <input
                aria-invalid={error?.kind === "err" ? true : undefined}
                autoComplete="current-password"
                className="inp"
                id="pw"
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
              <span className="hint">
                Mínimo de {MIN_PASSWORD} caracteres. Frases longas e
                gerenciadores de senha são bem-vindos.
              </span>
            </div>
            <div aria-live="polite">
              {error === null ? null : (
                <Banner kind={error.kind} role="alert">
                  {error.kind === "err" ? (
                    <b>E-mail ou senha incorretos.</b>
                  ) : null}
                  {error.kind === "err"
                    ? " Confira os dados e tente de novo."
                    : error.text}
                </Banner>
              )}
            </div>
            <button
              className={`btn primary lg${busy ? " loading" : ""}`}
              type="submit"
            >
              Entrar
            </button>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <button
                className="btn ghost sm"
                onClick={() => setDialog("forgot")}
                type="button"
              >
                Esqueci a senha
              </button>
              <button
                className="btn ghost sm"
                onClick={() => setDialog("invite")}
                type="button"
              >
                Tenho um convite
              </button>
            </div>
          </form>
          <p className="xs muted">
            <Icon name="lock" size="sm" /> O conteúdo do trabalho é cifrado
            neste navegador antes de sair dele.
          </p>
        </section>
      </div>
      {dialog === "forgot" ? (
        <ForgotDialog onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "invite" ? (
        <InviteDialog onClose={() => setDialog(null)} onOpen={onInvitation} />
      ) : null}
    </div>
  );
}

export function InvitationScreen({
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const accountMatches =
    account === undefined || account.email === invitation.email;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accountMatches) return;
    setBusy(true);
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
        blip("err");
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
      const loggedIn = await login(client, invitation.email, password);
      if (loggedIn !== "authenticated") {
        toast("Convite aceito. Entre com a senha que você acabou de criar.");
        onSignIn();
        return;
      }
      const current = await fetchCurrentAccount(client);
      if (current === null) throw new Error("session not created");
      onAccepted(current);
    } catch {
      setError("Não foi possível aceitar o convite.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id="app">
      <div className="login">
        <section className="login-art">
          <div className="brand" style={{ padding: 0, color: "var(--papel)" }}>
            <Logo />
            <span>{APP_NAME}</span>
          </div>
          <div>
            <div className="pdlg" style={{ marginBottom: 18, maxWidth: 320 }}>
              <Typewriter text="Um convite. Um começo compartilhado." />
            </div>
            <div className="stage-px">
              <div className="floor" />
              <Duo gap={24} pose="wave" scale={6} />
            </div>
          </div>
          <h2>
            Trabalho bom
            <br />
            <em>é trabalho junto.</em>
          </h2>
        </section>
        <section className="login-form">
          <div>
            <h1>Aceite seu convite</h1>
            <p className="muted" style={{ marginTop: 6 }}>
              O acesso foi enviado para <b>{invitation.email}</b>. O convite
              vale uma vez e só para este e-mail.
            </p>
          </div>
          <form className="col gap16" onSubmit={(event) => void submit(event)}>
            {account === undefined ? (
              <div className="field">
                <label htmlFor="np">Crie uma senha</label>
                <input
                  autoComplete="new-password"
                  className="inp"
                  id="np"
                  minLength={MIN_PASSWORD}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
                <span className="hint">
                  Mínimo de {MIN_PASSWORD} caracteres.
                </span>
              </div>
            ) : null}
            {!accountMatches ? (
              <Banner kind="warn" role="alert">
                Você está conectado como {account?.email}. Entre com a conta do
                convite.
              </Banner>
            ) : null}
            {error === "" ? null : (
              <Banner kind="err" role="alert">
                {error}
              </Banner>
            )}
            <button
              className={`btn primary lg${busy ? " loading" : ""}`}
              disabled={!accountMatches}
              type="submit"
            >
              Aceitar convite
            </button>
            {account === undefined ? (
              <button className="btn ghost" onClick={onSignIn} type="button">
                Já tenho uma conta
              </button>
            ) : null}
          </form>
        </section>
      </div>
    </div>
  );
}

/** The page behind the link in a password reset e-mail. */
export function ResetPasswordScreen({
  token,
  onDone,
}: {
  token: string;
  onDone: () => void;
}) {
  const client = useMemo(() => createApiClient(""), []);
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== again) {
      setError("As senhas não são iguais.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await confirmPasswordReset(client, token, password);
      if (result === "changed") {
        toast("Senha redefinida. Entre com a nova senha.", { icon: "check" });
        onDone();
        return;
      }
      blip("err");
      setError(
        result === "weak"
          ? `Use pelo menos ${MIN_PASSWORD} caracteres.`
          : result === "rate-limited"
            ? "Muitas tentativas. Aguarde um instante."
            : "Este link é inválido, já foi usado ou expirou. Peça um novo.",
      );
    } catch {
      setError("Não foi possível redefinir a senha agora.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id="app">
      <div className="login">
        <section className="login-art">
          <div className="brand" style={{ padding: 0, color: "var(--papel)" }}>
            <Logo />
            <span>{APP_NAME}</span>
          </div>
          <div className="stage-px" style={{ justifyContent: "flex-start" }}>
            <div className="floor" />
            <Duo gap={24} pose="think" scale={6} />
          </div>
          <h2>
            Nova senha,
            <br />
            <em>mesmo histórico.</em>
          </h2>
        </section>
        <section className="login-form">
          <div>
            <h1>Redefinir senha</h1>
            <p className="muted" style={{ marginTop: 6 }}>
              O link vale uma vez e encerra as sessões anteriores.
            </p>
          </div>
          <form className="col gap16" onSubmit={(event) => void submit(event)}>
            <div className="field">
              <label htmlFor="rp1">Nova senha</label>
              <input
                autoComplete="new-password"
                className="inp"
                id="rp1"
                minLength={MIN_PASSWORD}
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
              <span className="hint">Mínimo de {MIN_PASSWORD} caracteres.</span>
            </div>
            <div className="field">
              <label htmlFor="rp2">Repita a senha</label>
              <input
                autoComplete="new-password"
                className="inp"
                id="rp2"
                onChange={(event) => setAgain(event.target.value)}
                required
                type="password"
                value={again}
              />
            </div>
            {error === "" ? null : (
              <Banner kind="err" role="alert">
                {error}
              </Banner>
            )}
            <Banner>
              Redefinir a senha <b>não restaura o histórico cifrado</b>. Depois
              de entrar, este dispositivo ainda precisa ser liberado.
            </Banner>
            <button
              className={`btn primary lg${busy ? " loading" : ""}`}
              type="submit"
            >
              Redefinir senha
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

/** Shown while the session or the security state is still being read. */
export function StatusScreen({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div id="app">
      <div className="login">
        <section className="login-art">
          <div className="brand" style={{ padding: 0, color: "var(--papel)" }}>
            <Logo />
            <span>{APP_NAME}</span>
          </div>
          <div className="stage-px" style={{ justifyContent: "flex-start" }}>
            <div className="floor" />
            <Sprite pose="load" scale={7} who="tela" />
          </div>
          <h2>
            Um instante.
            <br />
            <em>Já abrimos.</em>
          </h2>
        </section>
        <section className="login-form">
          <h1>{title}</h1>
          {children}
        </section>
      </div>
    </div>
  );
}

/** Four by four grid derived from a fingerprint: a quick visual check, never a substitute for the text. */
function fingerprintCells(seed: string): number[] {
  let hash = 0;
  for (const character of seed)
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const cells: number[] = [];
  for (let index = 0; index < 16; index++) {
    hash = (hash * 1103515245 + 12345) >>> 0;
    cells.push((hash >> 16) & 1);
  }
  return cells;
}

function FingerprintCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="card pad row" style={{ gap: 18, alignItems: "flex-start" }}>
      <div
        aria-hidden="true"
        className="fpgrid"
        style={{ width: 88, flex: "none" }}
      >
        {fingerprintCells(value).map((cell, index) => (
          <i
            key={index}
            style={{
              animationDelay: `${index * 40}ms`,
              ...(cell === 1 ? {} : { opacity: 0.12 }),
            }}
          />
        ))}
      </div>
      <div className="col gap4">
        <span className="lbl">{label}</span>
        <span className="fp">{value}</span>
        <span className="xs muted">{hint}</span>
      </div>
    </div>
  );
}

/**
 * The step between signing in and reading content: this browser may still need
 * its keys. Signing in and being able to decrypt are different things.
 */
export function DeviceGate({
  account,
  onContinue,
  onLogout,
}: {
  account: CurrentAccount;
  onContinue: () => void;
  onLogout: () => void;
}) {
  const e2ee = useE2EE();
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mismatch = passphrase !== confirm || passphrase.length < MIN_PASSWORD;

  async function run(action: () => Promise<unknown>, failure: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      setPassphrase("");
      setConfirm("");
    } catch {
      setError(failure);
      blip("err");
    } finally {
      setBusy(false);
    }
  }

  const phase = e2ee.phase;
  const pending = phase === "pending_approval";

  const passphraseFields = (withConfirm: boolean) => (
    <>
      <div className="field">
        <label htmlFor="gp">Senha de proteção deste navegador</label>
        <input
          autoComplete={withConfirm ? "new-password" : "current-password"}
          className="inp"
          id="gp"
          minLength={MIN_PASSWORD}
          onChange={(event) => setPassphrase(event.target.value)}
          required
          type="password"
          value={passphrase}
        />
        <span className="hint">
          Ela abre as chaves guardadas aqui e nunca sai deste navegador. Mínimo
          de {MIN_PASSWORD} caracteres.
        </span>
      </div>
      {withConfirm ? (
        <div className="field">
          <label htmlFor="gc">Repita a senha</label>
          <input
            autoComplete="new-password"
            className="inp"
            id="gc"
            onChange={(event) => setConfirm(event.target.value)}
            required
            type="password"
            value={confirm}
          />
        </div>
      ) : null}
    </>
  );

  const skip = (label: string) => (
    <button className="btn ghost" onClick={onContinue} type="button">
      {label}
    </button>
  );

  return (
    <div id="app">
      <div className="login">
        <section className="login-art">
          <div className="brand" style={{ padding: 0, color: "var(--papel)" }}>
            <Logo />
            <span>{APP_NAME}</span>
          </div>
          <div className="stage-px" style={{ justifyContent: "flex-start" }}>
            <div className="floor" />
            <Sprite
              pose={busy || pending ? "load" : "idle"}
              scale={7}
              who="tela"
            />
            <Sprite pose="sit" scale={7} who="capuz" />
          </div>
          <h2>
            Seu histórico
            <br />
            <em>espera por você.</em>
          </h2>
        </section>
        <section className="login-form">
          {phase === "loading" ? <h1>Verificando este dispositivo…</h1> : null}

          {phase === "not_configured" ? (
            <form
              className="col gap16"
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  () => e2ee.setupOrganization(passphrase),
                  "Não foi possível ativar. Se já houver chave configurada, recarregue a página.",
                );
              }}
            >
              <div>
                <h1>Ative a criptografia</h1>
                <p className="muted" style={{ marginTop: 8 }}>
                  Será criada a chave de confiança da organização e a identidade
                  de recuperação, protegidas pela senha abaixo. Guarde a senha e
                  o arquivo de backup fora deste servidor: sem eles o histórico
                  não pode ser recuperado.
                </p>
              </div>
              {passphraseFields(true)}
              <button
                className={`btn primary lg${busy ? " loading" : ""}`}
                disabled={mismatch}
                type="submit"
              >
                Ativar criptografia
              </button>
              {skip("Agora não")}
            </form>
          ) : null}

          {phase === "needs_device" ? (
            <form
              className="col gap16"
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  () => e2ee.setupDevice(passphrase, fingerprint),
                  "A impressão digital não confere com a do servidor ou o registro falhou.",
                );
              }}
            >
              <div>
                <h1>Registrar este navegador</h1>
                <p className="muted" style={{ marginTop: 8 }}>
                  Você entrou na conta, mas este navegador ainda não pode
                  descriptografar o conteúdo. Confira a impressão digital da
                  organização com a administração, por outro canal, e digite-a
                  para confirmar.
                </p>
              </div>
              <FingerprintCard
                hint="Se a sequência for diferente da que a administração mostra, pare aqui."
                label="Impressão digital da organização"
                value={e2ee.rootFingerprint ?? ""}
              />
              <div className="field">
                <label htmlFor="gf">Digite a impressão digital</label>
                <input
                  autoComplete="off"
                  className="inp mono"
                  id="gf"
                  onChange={(event) => setFingerprint(event.target.value)}
                  required
                  value={fingerprint}
                />
              </div>
              {passphraseFields(true)}
              <button
                className={`btn primary lg${busy ? " loading" : ""}`}
                disabled={mismatch}
                type="submit"
              >
                Registrar este navegador
              </button>
              {skip("Continuar sem liberar")}
            </form>
          ) : null}

          {pending ? (
            <div className="col gap16">
              <div>
                <h1>Aguardando liberação do histórico</h1>
                <p className="muted" style={{ marginTop: 8 }}>
                  Você entrou na conta, mas este dispositivo ainda não pode
                  descriptografar o conteúdo. Aprove-o em um dispositivo de
                  confiança ou peça ao administrador de recuperação.
                </p>
              </div>
              <FingerprintCard
                hint="Confira se os dois dispositivos mostram a mesma sequência antes de aprovar."
                label="Impressão digital deste dispositivo"
                value={e2ee.deviceFingerprint ?? ""}
              />
              <Banner>
                Uma conta sem conteúdo <b>não significa</b> que o histórico não
                existe. Ele só aparece depois da liberação.
              </Banner>
              {skip("Continuar sem o histórico")}
            </div>
          ) : null}

          {phase === "locked" ? (
            <form
              className="col gap16"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  if (!(await e2ee.unlock(passphrase)))
                    throw new Error("wrong");
                  toast("Dispositivo liberado. Bem-vindo de volta.", {
                    mascot: "tela",
                    pose: "wave",
                    ms: 3200,
                  });
                }, "Senha incorreta.");
              }}
            >
              <div>
                <h1>Desbloqueie este navegador</h1>
                <p className="muted" style={{ marginTop: 8 }}>
                  As chaves ficam guardadas aqui, protegidas pela senha deste
                  navegador. Digite-a para ler e escrever conteúdo cifrado.
                </p>
              </div>
              {passphraseFields(false)}
              {error === "" ? null : (
                <Banner kind="err" role="alert">
                  {error}
                </Banner>
              )}
              <button
                className={`btn primary lg${busy ? " loading" : ""}`}
                type="submit"
              >
                Desbloquear
              </button>
              {skip("Entrar sem desbloquear")}
            </form>
          ) : null}

          {phase === "revoked" ? (
            <div className="col gap16">
              <div>
                <h1>Este dispositivo foi revogado</h1>
                <p className="muted" style={{ marginTop: 8 }}>
                  Ele não recebe novas chaves. Conteúdo que já estava aberto
                  aqui não pode ser apagado à distância.
                </p>
              </div>
              <button
                className="btn"
                onClick={() => void e2ee.resetThisBrowser()}
                type="button"
              >
                Esquecer este navegador
              </button>
              {skip("Continuar")}
            </div>
          ) : null}

          {phase === "error" ? (
            <div className="col gap16">
              <h1>Não foi possível verificar a segurança</h1>
              <Banner kind="err" role="alert">
                {e2ee.error}
              </Banner>
              {skip("Continuar mesmo assim")}
            </div>
          ) : null}

          {error !== "" && phase !== "locked" ? (
            <Banner kind="err" role="alert">
              {error}
            </Banner>
          ) : null}
          {e2ee.persistent ? null : (
            <Banner kind="warn">
              Este navegador não guarda dados locais: as chaves se perdem ao
              fechar a página.
            </Banner>
          )}
          <button className="btn ghost" onClick={onLogout} type="button">
            Sair
          </button>
          <p className="xs muted">Conta: {account.email}</p>
        </section>
      </div>
    </div>
  );
}
