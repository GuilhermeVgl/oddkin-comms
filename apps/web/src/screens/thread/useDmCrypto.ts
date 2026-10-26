import { getConversationKeyDomain } from "@crewstead/api-client";
import { useCallback, useEffect, useState } from "react";
import { useOptionalE2EE } from "../../e2ee/E2EE";
import type { ContentCrypto } from "../../e2ee/projectCrypto";
import { useReloadOn } from "../../events";
import { useWorkspace } from "../../workspace";

const KEY_EVENTS = ["key-domain.changed"];

/** The DM's keys: the conversation's own domain, opened while this browser is unlocked. */
export function useDmCrypto(id: string, active: boolean) {
  const e2ee = useOptionalE2EE();
  const unlocked = e2ee?.phase === "unlocked";
  const { client } = useWorkspace();
  const [crypto, setCrypto] = useState<ContentCrypto | null>(null);
  const [keyed, setKeyed] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    setCrypto(null);
    if (!active) return undefined;
    getConversationKeyDomain(client, id)
      .then((domain) => alive && setKeyed((domain?.currentGeneration ?? 0) > 0))
      .catch(() => alive && setKeyed(false));
    if (unlocked && e2ee !== null) {
      e2ee
        .openConversation(id, { maintain: true })
        .then((opened) => alive && setCrypto(opened))
        .catch(() => alive && setCrypto(null));
    }
    return () => {
      alive = false;
    };
  }, [client, id, active, unlocked, e2ee, version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useReloadOn(KEY_EVENTS, refresh);

  return { crypto, keyed, unlocked, refresh };
}
