import type { KeyValueStore } from "./storage";

/**
 * What an invitation that includes history needs on both sides.
 *
 * The inviting administrator's browser makes a secret, puts it in the e-mailed
 * link's fragment and keeps a copy. The invited browser registers its device
 * with a proof of that secret; the administrator's browser, which alone has the
 * secret and the root key, checks the proof and approves. The server only ever
 * relays the link, so a device it invents cannot be approved.
 */

export type InviteSecret = {
  invitationId: string;
  email: string;
  /** base64url, 32 bytes. */
  secret: string;
  createdAt: number;
};

const WEEK = 8 * 24 * 3600 * 1000;
const secretsKey = (accountId: string) => `invite-secrets:${accountId}`;

function isSecret(value: unknown): value is InviteSecret {
  const entry = value as Partial<InviteSecret> | null;
  return (
    typeof entry?.invitationId === "string" &&
    typeof entry.secret === "string" &&
    typeof entry.createdAt === "number"
  );
}

export async function loadInviteSecrets(
  store: KeyValueStore,
  accountId: string,
  now = Date.now(),
): Promise<InviteSecret[]> {
  const stored = await store.get(secretsKey(accountId));
  if (!Array.isArray(stored)) return [];
  // An invitation lives seven days; its secret does not need to outlive it.
  return stored
    .filter(isSecret)
    .filter((entry) => now - entry.createdAt < WEEK);
}

export async function saveInviteSecret(
  store: KeyValueStore,
  accountId: string,
  entry: InviteSecret,
): Promise<void> {
  const rest = (await loadInviteSecrets(store, accountId)).filter(
    (other) => other.invitationId !== entry.invitationId,
  );
  await store.put(secretsKey(accountId), [...rest, entry]);
}

export async function dropInviteSecret(
  store: KeyValueStore,
  accountId: string,
  invitationId: string,
): Promise<void> {
  const rest = (await loadInviteSecrets(store, accountId)).filter(
    (other) => other.invitationId !== invitationId,
  );
  await store.put(secretsKey(accountId), rest);
}

/** What the invited person's browser keeps from the link until its device is registered. */
export type Provision = {
  email: string;
  secret: string;
  rootFingerprint: string;
};

const PROVISION_KEY = "crewstead.provision";

export function rememberProvision(value: Provision): void {
  try {
    window.sessionStorage.setItem(PROVISION_KEY, JSON.stringify(value));
  } catch {
    // Without storage the person falls back to the manual step.
  }
}

export function readProvision(email: string): Provision | null {
  try {
    const raw = window.sessionStorage.getItem(PROVISION_KEY);
    if (raw === null) return null;
    const value = JSON.parse(raw) as Partial<Provision>;
    if (
      typeof value.email === "string" &&
      typeof value.secret === "string" &&
      typeof value.rootFingerprint === "string" &&
      value.email.toLowerCase() === email.toLowerCase()
    ) {
      return value as Provision;
    }
  } catch {
    // Unreadable: treat as absent.
  }
  return null;
}

export function clearProvision(): void {
  try {
    window.sessionStorage.removeItem(PROVISION_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Compares fingerprints the way people type them: spaces and case do not matter. */
export function sameFingerprint(a: string, b: string): boolean {
  const clean = (value: string) => value.replace(/\s/g, "").toLowerCase();
  return clean(a) !== "" && clean(a) === clean(b);
}
