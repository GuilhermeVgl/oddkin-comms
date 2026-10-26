import type { CurrentAccount, Sprint } from "@crewstead/api-client";
import { Banner } from "../../design/primitives";
import { go } from "../../design/router";
import { toast } from "../../design/toast";
import { useOptionalE2EE } from "../../e2ee/E2EE";
import { encryptSprint } from "../../e2ee/content";
import { useWorkspace } from "../../workspace";

/** Tells how readable the sprint names are for this person and what to do about it. */
export function SprintBanners({
  account,
  sprints,
}: {
  account: CurrentAccount;
  sprints: Sprint[];
}) {
  const e2ee = useOptionalE2EE();
  const { client, run, orgCrypto, orgKeyed, unlocked } = useWorkspace();

  async function encryptNames() {
    if (orgCrypto === null) return;
    await run(async () => {
      await orgCrypto.enable();
      for (const sprint of sprints) {
        if (!sprint.encrypted) await encryptSprint(client, orgCrypto, sprint);
      }
    });
    toast("Nomes e objetivos das sprints agora são cifrados.", {
      icon: "shieldOk",
    });
  }

  if (account.isAdmin && unlocked && !orgKeyed && sprints.length > 0) {
    return (
      <div className="sp-mb16">
        <Banner kind="warn">
          <b>Nomes e objetivos das sprints ainda ficam em texto claro.</b>{" "}
          <button
            className="btn sm"
            onClick={() => void encryptNames()}
            type="button"
          >
            Cifrar nomes de sprints
          </button>
        </Banner>
      </div>
    );
  }
  if (orgKeyed && !unlocked && e2ee?.phase === "not_enabled") {
    return (
      <div className="sp-mb16">
        <Banner icon="lock" kind="warn">
          Você entrou sem acesso ao histórico cifrado, então os nomes das
          sprints ficam ocultos.{" "}
          <button
            className="btn sm"
            onClick={() => void e2ee.requestHistoryAccess()}
            type="button"
          >
            Pedir acesso
          </button>
        </Banner>
      </div>
    );
  }
  if (orgKeyed && !unlocked && e2ee?.autoManaged === true) {
    return (
      <div className="sp-mb16">
        <Banner icon="lock">
          Liberando seu histórico: a administração aprova este navegador sozinha
          assim que estiver online.
        </Banner>
      </div>
    );
  }
  if (orgKeyed && !unlocked) {
    return (
      <div className="sp-mb16">
        <Banner icon="lock" kind="warn">
          Libere a criptografia deste navegador para ler os nomes das sprints.{" "}
          <button
            className="btn sm"
            onClick={() => go("settings/dispositivos")}
            type="button"
          >
            Abrir dispositivos
          </button>
        </Banner>
      </div>
    );
  }
  return null;
}
