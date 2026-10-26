import type { ReactNode } from "react";
import { Banner } from "../../design/primitives";
import { toast } from "../../design/toast";
import type { E2EEApi } from "../../e2ee/E2EE";
import { FingerprintCard } from "./FingerprintCard";

/** What every step of the gate is handed. */
export type StepProps = {
  e2ee: E2EEApi;
  busy: boolean;
  error: string;
  /** Runs an action with the busy state; `failure` is shown if it throws. */
  run: (action: () => Promise<unknown>, failure: string) => Promise<void>;
  onContinue: () => void;
};

function StepIntro({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h1>{title}</h1>
      <p className="muted login-lead loose">{children}</p>
    </div>
  );
}

function ErrorNotice({ error }: { error: string }) {
  return error === "" ? null : (
    <Banner kind="err" role="alert">
      {error}
    </Banner>
  );
}

function SubmitButton({
  busy,
  children,
}: {
  busy: boolean;
  children: ReactNode;
}) {
  return (
    <button className={`btn primary lg${busy ? " loading" : ""}`} type="submit">
      {children}
    </button>
  );
}

function SkipButton({
  label,
  onContinue,
}: {
  label: string;
  onContinue: () => void;
}) {
  return (
    <button className="btn ghost" onClick={onContinue} type="button">
      {label}
    </button>
  );
}

/** The organization has no keys yet: this browser creates them. */
export function ActivateStep({
  e2ee,
  busy,
  error,
  run,
  onContinue,
}: StepProps) {
  return (
    <form
      className="col gap16"
      onSubmit={(event) => {
        event.preventDefault();
        void run(
          () => e2ee.setupOrganization(),
          "Não foi possível ativar. Tente de novo; o que já foi feito é aproveitado.",
        );
      }}
    >
      <StepIntro title="Ative a criptografia">
        As chaves da equipe são criadas e guardadas neste navegador. Você
        continua usando só a senha da sua conta: não há outra senha para
        lembrar.
      </StepIntro>
      <Banner>
        Depois de ativar, gere em Configurações o <b>backup de recuperação</b> e
        guarde a chave dele fora deste computador: é o que salva o histórico se
        este navegador for perdido.
      </Banner>
      <ErrorNotice error={error} />
      <SubmitButton busy={busy}>Ativar criptografia</SubmitButton>
      <SkipButton label="Agora não" onContinue={onContinue} />
    </form>
  );
}

/** The organization has keys; this browser asks to be let in. */
export function RequestAccessStep({
  e2ee,
  busy,
  error,
  run,
  onContinue,
}: StepProps) {
  return (
    <form
      className="col gap16"
      onSubmit={(event) => {
        event.preventDefault();
        void run(
          () => e2ee.setupDevice(),
          "Não foi possível registrar este navegador agora.",
        );
      }}
    >
      <StepIntro title="Pedir acesso ao histórico">
        Você entrou na conta, mas este navegador ainda não pode ler o conteúdo
        cifrado. Peça o acesso: a administração aprova e o histórico aparece
        aqui, sem senha extra.
      </StepIntro>
      <FingerprintCard
        hint="A chave da organização que este navegador vai reconhecer. A administração pode confirmar que é a mesma."
        label="Impressão digital da organização"
        value={e2ee.rootFingerprint ?? ""}
      />
      <ErrorNotice error={error} />
      <SubmitButton busy={busy}>Pedir acesso</SubmitButton>
      <SkipButton label="Continuar sem o histórico" onContinue={onContinue} />
    </form>
  );
}

/** Waiting for a trusted device (or the recovery administrator) to approve this one. */
export function PendingStep({ e2ee, onContinue }: StepProps) {
  return (
    <div className="col gap16">
      <StepIntro title="Aguardando liberação do histórico">
        Você entrou na conta, mas este dispositivo ainda não pode
        descriptografar o conteúdo. Aprove-o em um dispositivo de confiança ou
        peça ao administrador de recuperação.
      </StepIntro>
      <FingerprintCard
        hint="Confira se os dois dispositivos mostram a mesma sequência antes de aprovar."
        label="Impressão digital deste dispositivo"
        value={e2ee.deviceFingerprint ?? ""}
      />
      <Banner>
        Uma conta sem conteúdo <b>não significa</b> que o histórico não existe.
        Ele só aparece depois da liberação.
      </Banner>
      <SkipButton label="Continuar sem o histórico" onContinue={onContinue} />
    </div>
  );
}

/** An older browser that still has a passphrase of its own: type it once. */
export function UnlockStep({
  e2ee,
  busy,
  error,
  run,
  onContinue,
  passphrase,
  onPassphrase,
}: StepProps & { passphrase: string; onPassphrase: (value: string) => void }) {
  return (
    <form
      className="col gap16"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          if (!(await e2ee.unlock(passphrase))) throw new Error("wrong");
          toast("Dispositivo liberado. Bem-vindo de volta.", {
            mascot: "tela",
            pose: "wave",
            ms: 3200,
          });
        }, "Senha incorreta.");
      }}
    >
      <StepIntro title="Uma última vez">
        Este navegador foi configurado com uma senha própria. Digite-a agora e
        ela deixa de existir: daqui em diante basta a senha da sua conta.
      </StepIntro>
      <div className="field">
        <label htmlFor="gp">Senha antiga deste navegador</label>
        <input
          autoComplete="current-password"
          className="inp"
          id="gp"
          onChange={(event) => onPassphrase(event.target.value)}
          required
          type="password"
          value={passphrase}
        />
      </div>
      <ErrorNotice error={error} />
      <SubmitButton busy={busy}>Desbloquear</SubmitButton>
      <SkipButton label="Entrar sem desbloquear" onContinue={onContinue} />
    </form>
  );
}

/** This device lost its access; it can forget its keys. */
export function RevokedStep({ e2ee, onContinue }: StepProps) {
  return (
    <div className="col gap16">
      <StepIntro title="Este dispositivo foi revogado">
        Ele não recebe novas chaves. Conteúdo que já estava aberto aqui não pode
        ser apagado à distância.
      </StepIntro>
      <button
        className="btn"
        onClick={() => void e2ee.resetThisBrowser()}
        type="button"
      >
        Esquecer este navegador
      </button>
      <SkipButton label="Continuar" onContinue={onContinue} />
    </div>
  );
}

/** The security check itself failed. */
export function FailedStep({ e2ee, onContinue }: StepProps) {
  return (
    <div className="col gap16">
      <h1>Não foi possível verificar a segurança</h1>
      <Banner kind="err" role="alert">
        {e2ee.error}
      </Banner>
      <SkipButton label="Continuar mesmo assim" onContinue={onContinue} />
    </div>
  );
}
