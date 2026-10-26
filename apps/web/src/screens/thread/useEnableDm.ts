import { useState } from "react";
import { toast, toastError } from "../../design/toast";
import { migrateOwnMessages } from "../../e2ee/content";
import type { ContentCrypto } from "../../e2ee/projectCrypto";
import { csrfToken } from "../../errors";
import { useWorkspace } from "../../workspace";

/** Turns end-to-end encryption on for a DM and encrypts the person's older messages. */
export function useEnableDm({
  conversationId,
  meEmail,
  crypto,
  onEnabled,
}: {
  conversationId: string;
  meEmail: string;
  crypto: ContentCrypto | null;
  onEnabled: () => void;
}) {
  const { client } = useWorkspace();
  const [status, setStatus] = useState("");

  async function enable() {
    if (crypto === null) return;
    setStatus("Ativando…");
    try {
      await crypto.enable(csrfToken);
      const result = await migrateOwnMessages(
        client,
        csrfToken(),
        crypto,
        conversationId,
        meEmail,
        "dm",
      );
      setStatus("");
      toast(
        `Conversa cifrada. ${result.migrated} mensagens suas antigas foram cifradas.`,
        { icon: "shieldOk" },
      );
      onEnabled();
    } catch {
      setStatus("");
      toastError("Não foi possível ativar. Tente de novo.");
    }
  }

  return { status, enable };
}
