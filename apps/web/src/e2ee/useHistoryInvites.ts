import { setHistoryMode } from "@crewstead/api-client";
import { toBase64Url } from "@crewstead/crypto";
import { useMemo } from "react";
import { saveInviteSecret } from "./invitations";
import { historyInviteLink } from "./phase";
import { csrf } from "./runtime";
import type { E2EEApi } from "./types";
import type { Session } from "./useSession";

export type HistoryInvites = Pick<
  E2EEApi,
  "beginHistoryInvite" | "rememberHistoryInvite" | "requestHistoryAccess"
>;

/** Invitations that carry history, and the request to be shown the key step. */
export function useHistoryInvites(
  session: Session,
  rootFingerprint: string | null,
): HistoryInvites {
  return useMemo(() => {
    const { client, account, record, runtimeOf } = session;
    return {
      async beginHistoryInvite() {
        const { vault, crypto } = await runtimeOf();
        const current = record.current;
        if (
          current === null ||
          current.root === undefined ||
          !vault.unlocked ||
          vault.rootSecretKey() === undefined ||
          rootFingerprint === null
        ) {
          return null;
        }
        const secret = toBase64Url(crypto.generateDomainKey());
        return {
          secret,
          linkExtra: historyInviteLink(secret, rootFingerprint),
        };
      },

      async rememberHistoryInvite(invitationId, email, secret) {
        const { store } = await runtimeOf();
        await saveInviteSecret(store, account.id, {
          invitationId,
          email,
          secret,
          createdAt: Date.now(),
        });
      },

      async requestHistoryAccess() {
        await setHistoryMode(client, csrf(), "ask");
        window.location.reload();
      },
    };
  }, [session, rootFingerprint]);
}
