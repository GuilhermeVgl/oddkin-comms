import {
  acceptInvitation,
  createApiClient,
  fetchCurrentAccount,
  login,
  type CurrentAccount,
} from "@crewstead/api-client";
import React, { useMemo, useState } from "react";
import { Duo } from "../../design/Sprite";
import { Banner } from "../../design/primitives";
import { blip } from "../../design/sound";
import { toast } from "../../design/toast";
import { rememberProvision } from "../../e2ee/invitations";
import { ArtPanel, ArtStage, AuthLayout } from "./AuthLayout";
import {
  accountMatchesInvitation,
  invitationRejection,
  MIN_PASSWORD,
} from "./rules";
import type { PendingInvitation } from "./types";
import { Typewriter } from "./Typewriter";

/** Keeps the history secret from the link until this browser registers its device. */
function keepHistoryKey(invitation: PendingInvitation) {
  if (
    invitation.historyKey !== undefined &&
    invitation.rootFingerprint !== undefined
  ) {
    rememberProvision({
      email: invitation.email,
      secret: invitation.historyKey,
      rootFingerprint: invitation.rootFingerprint,
    });
  }
}

function InvitationArt() {
  return (
    <ArtPanel
      headline={
        <>
          Trabalho bom
          <br />
          <em>é trabalho junto.</em>
        </>
      }
    >
      <div>
        <div className="pdlg">
          <Typewriter text="Um convite. Um começo compartilhado." />
        </div>
        <ArtStage>
          <Duo gap={24} pose="wave" scale={6} />
        </ArtStage>
      </div>
    </ArtPanel>
  );
}

export function InvitationScreen({
  invitation,
  account,
  onAccepted,
  onConsumed,
  onSignIn,
  onSwitchAccount,
}: {
  invitation: PendingInvitation;
  account?: CurrentAccount;
  onAccepted: (account: CurrentAccount) => void;
  /** The invitation was used; forget it so a reload does not offer it again. */
  onConsumed: () => void;
  onSignIn: () => void;
  /** Ends the current session so the invited person can sign in. */
  onSwitchAccount?: () => void;
}) {
  const client = useMemo(() => createApiClient(""), []);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const accountMatches = accountMatchesInvitation(account, invitation);

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
      if (result !== "accepted") {
        setError(invitationRejection(result));
        if (result === "invalid") blip("err");
        return;
      }
      if (account !== undefined) {
        keepHistoryKey(invitation);
        onAccepted(account);
        return;
      }
      keepHistoryKey(invitation);
      onConsumed();
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
    <AuthLayout art={<InvitationArt />}>
      <div>
        <h1>Aceite seu convite</h1>
        <p className="muted login-lead">
          O acesso foi enviado para <b>{invitation.email}</b>. O convite vale
          uma vez e só para este e-mail.
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
            <span className="hint">Mínimo de {MIN_PASSWORD} caracteres.</span>
          </div>
        ) : null}
        {!accountMatches ? (
          <Banner kind="warn" role="alert">
            Você está conectado como {account?.email}. Entre com a conta do
            convite.
          </Banner>
        ) : null}
        {!accountMatches && onSwitchAccount !== undefined ? (
          <button className="btn" onClick={onSwitchAccount} type="button">
            Sair e usar a conta do convite
          </button>
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
    </AuthLayout>
  );
}
