import { useMemo } from "react";
import { CallCrypto } from "./callCrypto";
import { csrf } from "./runtime";
import { ContentCrypto } from "./projectCrypto";
import { scopeCacheKey } from "./phase";
import type { E2EEApi } from "./types";
import type { Session } from "./useSession";

export type ContentAccess = Pick<
  E2EEApi,
  | "openScope"
  | "openProject"
  | "openConversation"
  | "openOrganization"
  | "openCall"
>;

/** Hands screens the encrypt/decrypt objects for a scope, once this browser is unlocked. */
export function useContentAccess(session: Session): ContentAccess {
  return useMemo(() => {
    const { client, account, record, keyring, scopes, runtimeOf } = session;

    const openScope: ContentAccess["openScope"] = async (scope, options) => {
      const { crypto, vault } = await runtimeOf();
      const current = record.current;
      const ring = keyring.current;
      if (current === null || ring === null || !vault.unlocked) return null;
      const cacheKey = scopeCacheKey(scope);
      let opened = scopes.current.get(cacheKey);
      if (opened === undefined) {
        opened = new ContentCrypto(
          scope,
          client,
          crypto,
          vault,
          ring,
          account.id,
          current.deviceId,
        );
        scopes.current.set(cacheKey, opened);
      }
      await opened.refresh(options?.maintain ?? false);
      return opened;
    };

    return {
      openScope,
      openProject: (projectId, options) =>
        openScope({ type: "project", projectId }, options),
      openConversation: (conversationId, options) =>
        openScope({ type: "conversation", conversationId }, options),
      openOrganization: (options) =>
        openScope({ type: "organization" }, options),
      async openCall() {
        const { crypto, vault } = await runtimeOf();
        const current = record.current;
        const ring = keyring.current;
        if (current === null || ring === null || !vault.unlocked) return null;
        return new CallCrypto(
          client,
          crypto,
          vault,
          ring,
          current.deviceId,
          csrf,
        );
      },
    };
  }, [session]);
}
