import {
  createApiClient,
  fetchCurrentAccount,
  login,
  type CurrentAccount,
} from "@crewstead/api-client";
import React, { useMemo, useRef, useState } from "react";
import { APP_NAME } from "../../brand";
import { Icon } from "../../design/icons";
import { blip } from "../../design/sound";
import { Banner } from "../../design/primitives";
import type { DuoRef } from "../../design/Sprite";
import { AuthLayout } from "./AuthLayout";
import { ForgotDialog } from "./ForgotDialog";
import { InviteDialog } from "./InviteDialog";
import { LoginArt } from "./LoginArt";
import { loginFailure, MIN_PASSWORD, noticeParts, type Notice } from "./rules";
import type { PendingInvitation } from "./types";

/** The banner under the password field. Each failure says what went wrong. */
function LoginNotice({ notice }: { notice: Notice }) {
  const { strong, rest } = noticeParts(notice);
  return (
    <Banner kind={notice.kind} role="alert">
      {strong === "" ? null : <b>{strong}</b>}
      {rest}
    </Banner>
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
  const [error, setError] = useState<Notice | null>(null);
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
        setError(loginFailure(result));
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

  const overlay = (
    <>
      {dialog === "forgot" ? (
        <ForgotDialog onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "invite" ? (
        <InviteDialog onClose={() => setDialog(null)} onOpen={onInvitation} />
      ) : null}
    </>
  );

  return (
    <AuthLayout art={<LoginArt duo={duo} />} overlay={overlay}>
      <div>
        <h1>Entrar</h1>
        <p className="muted login-lead">
          Acesso por convite. Sua equipe, seus projetos, tudo cifrado de ponta a
          ponta.
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
            Mínimo de {MIN_PASSWORD} caracteres. Frases longas e gerenciadores
            de senha são bem-vindos.
          </span>
        </div>
        <div aria-live="polite">
          {error === null ? null : <LoginNotice notice={error} />}
        </div>
        <button
          className={`btn primary lg${busy ? " loading" : ""}`}
          type="submit"
        >
          Entrar
        </button>
        <div className="row between">
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
        <Icon name="lock" size="sm" /> O conteúdo do trabalho é cifrado neste
        navegador antes de sair dele.
      </p>
    </AuthLayout>
  );
}
