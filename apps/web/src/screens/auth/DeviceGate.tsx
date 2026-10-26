import type { CurrentAccount } from "@crewstead/api-client";
import { useState } from "react";
import { Banner } from "../../design/primitives";
import { blip } from "../../design/sound";
import { Sprite } from "../../design/Sprite";
import { useE2EE } from "../../e2ee/E2EE";
import { ArtPanel, ArtStage, AuthLayout } from "./AuthLayout";
import {
  ActivateStep,
  FailedStep,
  PendingStep,
  RequestAccessStep,
  RevokedStep,
  UnlockStep,
  type StepProps,
} from "./DeviceGateSteps";

function GateArt({ working }: { working: boolean }) {
  return (
    <ArtPanel
      headline={
        <>
          Seu histórico
          <br />
          <em>espera por você.</em>
        </>
      }
    >
      <ArtStage start>
        <Sprite pose={working ? "load" : "idle"} scale={7} who="tela" />
        <Sprite pose="sit" scale={7} who="capuz" />
      </ArtStage>
    </ArtPanel>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(action: () => Promise<unknown>, failure: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      setPassphrase("");
    } catch {
      setError(failure);
      blip("err");
    } finally {
      setBusy(false);
    }
  }

  const phase = e2ee.phase;
  const step: StepProps = { e2ee, busy, error, run, onContinue };

  return (
    <AuthLayout
      art={<GateArt working={busy || phase === "pending_approval"} />}
    >
      {phase === "loading" ? <h1>Verificando este dispositivo…</h1> : null}
      {phase === "not_configured" ? <ActivateStep {...step} /> : null}
      {phase === "needs_device" ? <RequestAccessStep {...step} /> : null}
      {phase === "pending_approval" ? <PendingStep {...step} /> : null}
      {phase === "locked" ? (
        <UnlockStep
          {...step}
          onPassphrase={setPassphrase}
          passphrase={passphrase}
        />
      ) : null}
      {phase === "revoked" ? <RevokedStep {...step} /> : null}
      {phase === "error" ? <FailedStep {...step} /> : null}

      {error !== "" && phase !== "locked" ? (
        <Banner kind="err" role="alert">
          {error}
        </Banner>
      ) : null}
      {e2ee.persistent ? null : (
        <Banner kind="warn">
          Este navegador não guarda dados locais: as chaves se perdem ao fechar
          a página.
        </Banner>
      )}
      <button className="btn ghost" onClick={onLogout} type="button">
        Sair
      </button>
      <p className="xs muted">Conta: {account.email}</p>
    </AuthLayout>
  );
}
