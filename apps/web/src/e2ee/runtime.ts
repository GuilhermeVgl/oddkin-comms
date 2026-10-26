import { createApiClient, readCookie } from "@crewstead/api-client";
import {
  createCrypto,
  createKeystore,
  loadSodium,
  type Crypto,
} from "@crewstead/crypto";
import { browserStore, type KeyValueStore } from "./storage";
import { Vault } from "./vault";

export type Client = ReturnType<typeof createApiClient>;

export type Runtime = { crypto: Crypto; vault: Vault; store: KeyValueStore };

export async function createRuntime(): Promise<Runtime> {
  const sodium = await loadSodium();
  const crypto = await createCrypto(sodium);
  const store = await browserStore();
  return {
    crypto,
    vault: new Vault(crypto, createKeystore(sodium), store),
    store,
  };
}

export function csrf(): string {
  const token = readCookie(document.cookie, "crewstead_csrf");
  if (token === null) throw new Error("missing csrf cookie");
  return token;
}
