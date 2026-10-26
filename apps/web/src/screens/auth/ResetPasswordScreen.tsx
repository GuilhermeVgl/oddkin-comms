import { confirmPasswordReset, createApiClient } from "@crewstead/api-client";
import React, { useMemo, useState } from "react";
import { Duo } from "../../design/Sprite";
import { Banner } from "../../design/primitives";
import { blip } from "../../design/sound";
import { toast } from "../../design/toast";
import { ArtPanel, ArtStage, AuthLayout } from "./AuthLayout";
import { MIN_PASSWORD, passwordsMismatch, resetConfirmFailure } from "./rules";

function ResetArt() {
  return (
    <ArtPanel
      headline={
        <>
          Nova senha,
          <br />
          <em>mesmo histórico.</em>
        </>
      }
    >
      <ArtStage start>
        <Duo gap={24} pose="think" scale={6} />
      </ArtStage>
    </ArtPanel>
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
    const mismatch = passwordsMismatch(password, again);
    if (mismatch !== "") {
      setError(mismatch);
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
      setError(resetConfirmFailure(result));
    } catch {
      setError("Não foi possível redefinir a senha agora.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout art={<ResetArt />}>
      <div>
        <h1>Redefinir senha</h1>
        <p className="muted login-lead">
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
          Redefinir a senha <b>não restaura o histórico cifrado</b>. Depois de
          entrar, este dispositivo ainda precisa ser liberado.
        </Banner>
        <button
          className={`btn primary lg${busy ? " loading" : ""}`}
          type="submit"
        >
          Redefinir senha
        </button>
      </form>
    </AuthLayout>
  );
}
