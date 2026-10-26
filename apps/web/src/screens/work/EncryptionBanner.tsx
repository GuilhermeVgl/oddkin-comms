import { listConversations } from "@crewstead/api-client";
import { useState } from "react";
import type { IconName } from "../../design/icons";
import { go } from "../../design/router";
import { Banner } from "../../design/primitives";
import { toast, toastError } from "../../design/toast";
import { useOptionalE2EE } from "../../e2ee/E2EE";
import {
  encryptChannel,
  encryptProject,
  migrateProject,
  type MigrationReport,
} from "../../e2ee/content";
import { describeError } from "../../errors";
import { useWorkspace, type ProjectState } from "../../workspace";

/** A status banner with the board's side margins. */
function Note({
  icon,
  kind,
  children,
}: {
  icon?: IconName;
  kind?: "ok" | "warn" | "err";
  children: React.ReactNode;
}) {
  return (
    <div className="wk-note">
      <Banner
        {...(icon === undefined ? {} : { icon })}
        {...(kind === undefined ? {} : { kind })}
        role="status"
      >
        {children}
      </Banner>
    </div>
  );
}

/** What this project does about encryption, and what the person can do about it. */
export function EncryptionBanner({ state }: { state: ProjectState }) {
  const { client, unlocked, reload, account } = useWorkspace();
  const e2ee = useOptionalE2EE();
  const [progress, setProgress] = useState("");
  const encrypted = state.crypto?.isEncrypted("work") ?? state.keyed;
  const legacy =
    state.items.filter((item) => !item.encrypted).length +
    state.epics.filter((epic) => !epic.encrypted).length;
  const manager = state.project.isManager;
  const pc = state.crypto;

  async function enable() {
    if (pc === null) return;
    setProgress("Ativando…");
    try {
      await pc.enable();
      await reload();
      setProgress("");
      toast("Criptografia ativada neste projeto.", { icon: "shieldOk" });
    } catch (error) {
      setProgress("");
      toastError(describeError(error));
    }
  }

  async function migrate() {
    if (pc === null) return;
    setProgress("Cifrando conteúdo antigo…");
    try {
      const channels = await listConversations(client, state.project.id).catch(
        () => [],
      );
      if (manager) {
        if (!state.project.encrypted)
          await encryptProject(client, pc, state.project);
        const channel = channels[0];
        if (channel !== undefined && !channel.encrypted)
          await encryptChannel(client, pc, channel);
      }
      const report: MigrationReport = await migrateProject(
        client,
        pc,
        {
          items: state.items,
          epics: state.epics,
          channelId: channels[0]?.id,
        },
        { email: account.email },
        (done, total) =>
          setProgress(`Cifrando conteúdo antigo… ${done}/${total}`),
      );
      setProgress("");
      toast(
        `Concluído: ${report.items} atividades, ${report.epics} épicos, ${report.comments} comentários, ${report.messages} mensagens${
          report.failed > 0 ? `; ${report.failed} falharam` : ""
        }.`,
        { icon: "shieldOk", ms: 6000 },
      );
      await reload();
    } catch (error) {
      setProgress("");
      toastError(describeError(error));
    }
  }

  if (encrypted && !unlocked && e2ee?.phase === "not_enabled") {
    return (
      <Note icon="lock" kind="warn">
        <b>Você não vê o histórico cifrado.</b> Este projeto é cifrado e você
        entrou sem acesso a ele.{" "}
        <button
          className="btn sm"
          onClick={() => void e2ee.requestHistoryAccess()}
          type="button"
        >
          Pedir acesso
        </button>
      </Note>
    );
  }
  if (encrypted && !unlocked && e2ee?.autoManaged === true) {
    return (
      <Note icon="lock">
        <b>Liberando seu histórico.</b> A administração aprova este navegador
        automaticamente assim que estiver online; nada para digitar.
      </Note>
    );
  }
  if (encrypted && !unlocked) {
    return (
      <Note icon="lock" kind="warn">
        <b>Este projeto é cifrado.</b> Libere a criptografia deste navegador
        para ler e escrever.{" "}
        <button
          className="btn sm"
          onClick={() => go("settings/dispositivos")}
          type="button"
        >
          Abrir dispositivos
        </button>
      </Note>
    );
  }
  if (encrypted && legacy > 0 && manager) {
    return (
      <Note kind="warn">
        <b>Ainda há {legacy} itens antigos em texto claro.</b> {progress}{" "}
        <button
          className={`btn sm${progress === "" ? "" : " loading"}`}
          onClick={() => void migrate()}
          type="button"
        >
          Cifrar conteúdo antigo
        </button>
      </Note>
    );
  }
  if (!encrypted && manager && unlocked) {
    return (
      <Note kind="warn">
        <b>Este projeto ainda guarda o conteúdo em texto claro no servidor.</b>{" "}
        {progress}{" "}
        <button
          className={`btn sm${progress === "" ? "" : " loading"}`}
          onClick={() => void enable()}
          type="button"
        >
          Ativar criptografia neste projeto
        </button>
      </Note>
    );
  }
  return null;
}
