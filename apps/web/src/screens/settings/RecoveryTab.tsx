import type { RecoveryAuditEntry, RecoveryGap } from "@crewstead/api-client";
import { useEffect, useState } from "react";
import { Banner } from "../../design/primitives";
import { useE2EE } from "../../e2ee/E2EE";
import {
  RecoveryAuditCard,
  RecoveryIdentityCard,
  RecoveryRequestsCard,
  RotateIdentityCard,
} from "./RecoveryCards";

export function RecoveryTab() {
  const e2ee = useE2EE();
  const [gaps, setGaps] = useState<RecoveryGap[]>([]);
  const [audit, setAudit] = useState<RecoveryAuditEntry[]>([]);
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((value) => value + 1);

  useEffect(() => {
    let alive = true;
    if (e2ee.phase !== "unlocked" || !e2ee.hasRecoveryIdentity)
      return undefined;
    e2ee
      .recoveryGaps()
      .then((list) => alive && setGaps(list))
      .catch(() => alive && setGaps([]));
    e2ee
      .recoveryAudit()
      .then((list) => alive && setAudit(list))
      .catch(() => alive && setAudit([]));
    return () => {
      alive = false;
    };
  }, [e2ee.phase, e2ee.hasRecoveryIdentity, version]);

  return (
    <div className="stack">
      <Banner kind="warn">
        <b>
          O administrador de recuperação pode descriptografar conteúdo,
          inclusive mensagens diretas.
        </b>{" "}
        O produto não é privado contra esse papel. A ação é explícita, local e
        auditada. Não existe rota que baixe texto em claro.
      </Banner>
      <RecoveryIdentityCard />
      <RecoveryRequestsCard gaps={gaps} onDone={refresh} />
      {e2ee.hasRecoveryIdentity ? (
        <RotateIdentityCard onDone={refresh} />
      ) : null}
      <RecoveryAuditCard audit={audit} />
    </div>
  );
}
