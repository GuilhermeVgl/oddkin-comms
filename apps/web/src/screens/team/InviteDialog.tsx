import {
  addMember,
  ApiStatusError,
  createInvitation,
  type MembershipKind,
} from "@crewstead/api-client";
import { useState } from "react";
import { Icon } from "../../design/icons";
import { Modal } from "../../design/Modal";
import { Banner } from "../../design/primitives";
import { toast, toastError } from "../../design/toast";
import { useOptionalE2EE } from "../../e2ee/E2EE";
import { describeError } from "../../errors";
import { useWorkspace } from "../../workspace";
import { isValidEmail } from "./teamRules";

function Segmented<T extends string>({
  label,
  labelId,
  value,
  options,
  onPick,
}: {
  label: string;
  labelId: string;
  value: T;
  options: {
    value: T;
    text: string;
    disabled?: boolean | undefined;
    title?: string | undefined;
  }[];
  onPick: (value: T) => void;
}) {
  return (
    <>
      <span className="lbl" id={labelId}>
        {label}
      </span>
      <div aria-labelledby={labelId} className="seg" role="group">
        {options.map((option) => (
          <button
            aria-pressed={value === option.value}
            disabled={option.disabled}
            key={option.value}
            onClick={() => onPick(option.value)}
            title={option.title}
            type="button"
          >
            {option.text}
          </button>
        ))}
      </div>
    </>
  );
}

export function InviteDialog({
  projectId,
  onClose,
  onInvited,
}: {
  projectId: string;
  onClose: () => void;
  onInvited?: () => void;
}) {
  const { client, reload, account } = useWorkspace();
  const [email, setEmail] = useState("");
  // Only administrators bring in people from inside the organization.
  const [kind, setKind] = useState<MembershipKind>(
    account.isAdmin ? "internal" : "external",
  );
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const e2ee = useOptionalE2EE();
  // Asked only where there is encryption to give access to.
  const askHistory =
    account.isAdmin && e2ee !== null && e2ee.phase !== "not_configured";
  const canGrant =
    e2ee?.canApproveWithRoot === true && e2ee.phase === "unlocked";
  const [history, setHistory] = useState<"yes" | "no">("yes");
  const grants = askHistory && history === "yes" && canGrant;

  async function invite(address: string) {
    const grant = grants ? await e2ee?.beginHistoryInvite() : null;
    const created = await createInvitation(
      client,
      address,
      kind,
      askHistory
        ? grant
          ? { historyMode: "auto", linkExtra: grant.linkExtra }
          : { historyMode: "none" }
        : undefined,
      projectId,
    );
    if (grant) {
      await e2ee?.rememberHistoryInvite(created.id, address, grant.secret);
    }
    toast("Convite criado e enfileirado para entrega.", { icon: "mail" });
    onInvited?.();
  }

  async function submit() {
    if (!isValidEmail(email)) {
      setInvalid(true);
      return;
    }
    setBusy(true);
    try {
      try {
        // Someone already in the organization only needs to join the project.
        await addMember(client, projectId, email.trim());
        toast("Pessoa adicionada ao projeto.", { icon: "check" });
        await reload();
      } catch (error) {
        if (
          !(error instanceof ApiStatusError) ||
          (error.status !== 404 && error.status !== 400)
        )
          throw error;
        await invite(email.trim());
      }
      onClose();
    } catch (error) {
      toastError(describeError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="dh">
        <h2 id="dlgt">Convidar para o projeto</h2>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="dbd col gap12">
          <div className="field">
            <label htmlFor="ive">E-mail</label>
            <input
              aria-invalid={invalid ? true : undefined}
              autoFocus
              className="inp"
              id="ive"
              onChange={(event) => {
                setEmail(event.target.value);
                setInvalid(false);
              }}
              placeholder="pessoa@empresa.com"
              type="email"
              value={email}
            />
            {invalid ? (
              <span className="err">
                <Icon name="alert" size="sm" />
                Informe um e-mail válido.
              </span>
            ) : null}
          </div>
          <div className="field">
            <Segmented
              label="Vínculo (para quem ainda não está na organização)"
              labelId="vl"
              onPick={setKind}
              options={[
                {
                  value: "internal",
                  text: "Interno",
                  disabled: !account.isAdmin,
                  title: account.isAdmin
                    ? undefined
                    : "Só a administração convida pessoas internas",
                },
                { value: "external", text: "Externo" },
              ]}
              value={kind}
            />
            <span className="hint">
              {kind === "external"
                ? "Externos só podem o que o perfil compartilhado do projeto permite."
                : "Internos colaboram nos projetos aos quais pertencem."}
            </span>
          </div>
          {askHistory ? (
            <div className="field">
              <Segmented
                label="Incluir o histórico cifrado da equipe?"
                labelId="hl"
                onPick={setHistory}
                options={[
                  { value: "yes", text: "Sim, incluir" },
                  { value: "no", text: "Não incluir" },
                ]}
                value={history}
              />
              <span className="hint">
                {history === "no"
                  ? "A pessoa entra sem ver o histórico cifrado e nunca é pedida uma chave. Ela pode pedir acesso depois, em Configurações."
                  : canGrant
                    ? "O convite já deixa o acesso pronto: a pessoa não digita chave nenhuma. A liberação acontece quando este navegador (o seu, de administração) estiver aberto."
                    : "Para incluir o histórico, desbloqueie este navegador (administração) nesta sessão. Sem isso o convite sai sem histórico."}
              </span>
            </div>
          ) : null}
          <Banner icon="mail">
            O convite expira em 7 dias, é de uso único e só funciona para este
            e-mail. Não incluímos títulos nem prazos no e-mail.
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
            Enviar convite
          </button>
        </div>
      </form>
    </Modal>
  );
}
