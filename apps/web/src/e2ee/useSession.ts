import { createApiClient, type CurrentAccount } from "@crewstead/api-client";
import { fromBase64Url } from "@crewstead/crypto";
import { useCallback, useMemo, useRef, type MutableRefObject } from "react";
import { Keyring } from "./keyring";
import type { ContentCrypto } from "./projectCrypto";
import { createRuntime, type Client, type Runtime } from "./runtime";
import type { VaultRecord } from "./vault";

/** What every part of the provider shares: the API client, the account and the live refs. */
export type Session = {
  client: Client;
  account: CurrentAccount;
  runtime: MutableRefObject<Runtime | null>;
  record: MutableRefObject<VaultRecord | null>;
  keyring: MutableRefObject<Keyring | null>;
  /** Opened content scopes, keyed by scopeCacheKey. */
  scopes: MutableRefObject<Map<string, ContentCrypto>>;
  runtimeOf(): Promise<Runtime>;
  /** Builds the keyring from the saved device record; throws when there is none. */
  buildKeyring(): Promise<void>;
};

export function useSession(account: CurrentAccount): Session {
  const client = useMemo<Client>(() => createApiClient(""), []);
  const runtime = useRef<Runtime | null>(null);
  const record = useRef<VaultRecord | null>(null);
  const keyring = useRef<Keyring | null>(null);
  const scopes = useRef(new Map<string, ContentCrypto>());

  const runtimeOf = useCallback(async (): Promise<Runtime> => {
    runtime.current ??= await createRuntime();
    return runtime.current;
  }, []);

  const buildKeyring = useCallback(async () => {
    const { vault, crypto } = await runtimeOf();
    const current = record.current;
    if (current === null) throw new Error("no device");
    keyring.current = new Keyring({
      client,
      crypto,
      vault,
      pinnedRoot: fromBase64Url(current.pinnedRoot),
      accountId: account.id,
      deviceId: current.deviceId,
    });
    scopes.current.clear();
  }, [account.id, client, runtimeOf]);

  return useMemo(
    () => ({
      client,
      account,
      runtime,
      record,
      keyring,
      scopes,
      runtimeOf,
      buildKeyring,
    }),
    [client, account, runtimeOf, buildKeyring],
  );
}
