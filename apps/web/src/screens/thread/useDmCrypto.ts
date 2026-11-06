import { getConversationKeyDomain } from "@crewstead/api-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useOptionalE2EE } from "../../e2ee/E2EE";
import type { ContentCrypto } from "../../e2ee/projectCrypto";
import { useReloadOn } from "../../events";
import { useWorkspace } from "../../workspace";

const KEY_EVENTS = ["key-domain.changed"];

/** The DM's keys: the conversation's own domain, opened while this browser is unlocked. */
export function useDmCrypto(id: string, active: boolean) {
  const e2ee = useOptionalE2EE();
  const unlocked = e2ee?.phase === "unlocked";
  const e2eeRef = useRef(e2ee);
  e2eeRef.current = e2ee;
  const { client } = useWorkspace();
  const [crypto, setCrypto] = useState<ContentCrypto | null>(null);
  const [keyed, setKeyed] = useState(false);
  const [ready, setReady] = useState(!active);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    setCrypto(null);
    setKeyed(false);
    setReady(!active);
  }, [id, active]);

  useEffect(() => {
    let alive = true;
    if (!active) return undefined;
    setReady(false);
    const current = e2eeRef.current;
    const open = async () => {
      if (unlocked && current !== null) {
        const opened = await current.openConversation(id, {
          maintain: false,
          refresh: true,
        });
        if (!alive) return;
        setCrypto(opened);
        setKeyed(opened?.isEncrypted("dm") ?? false);
        setReady(true);
        return;
      }
      const domain = await getConversationKeyDomain(client, id);
      if (!alive) return;
      setCrypto(null);
      setKeyed((domain?.currentGeneration ?? 0) > 0);
      setReady(true);
    };
    void open().catch(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [client, id, active, unlocked, version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useReloadOn(KEY_EVENTS, refresh);

  return { crypto, keyed, unlocked, ready, refresh };
}
