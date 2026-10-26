import { describe, expect, it } from "vitest";
import { memoryStore } from "./storage";
import {
  dropInviteSecret,
  loadInviteSecrets,
  sameFingerprint,
  saveInviteSecret,
} from "./invitations";

const entry = (id: string, createdAt = Date.now()) => ({
  invitationId: id,
  email: `${id}@example.test`,
  secret: "s".repeat(43),
  createdAt,
});

describe("invitation secrets kept by the inviting browser", () => {
  it("keeps one entry per invitation and drops it once used", async () => {
    const store = memoryStore();
    await saveInviteSecret(store, "admin", entry("a"));
    await saveInviteSecret(store, "admin", entry("b"));
    await saveInviteSecret(store, "admin", entry("a"));
    expect(
      (await loadInviteSecrets(store, "admin"))
        .map((e) => e.invitationId)
        .sort(),
    ).toEqual(["a", "b"]);
    await dropInviteSecret(store, "admin", "a");
    expect(
      (await loadInviteSecrets(store, "admin")).map((e) => e.invitationId),
    ).toEqual(["b"]);
  });

  it("forgets secrets older than an invitation can live and ignores damaged data", async () => {
    const store = memoryStore();
    const now = Date.now();
    await saveInviteSecret(
      store,
      "admin",
      entry("old", now - 9 * 24 * 3600 * 1000),
    );
    await saveInviteSecret(store, "admin", entry("fresh", now));
    expect(
      (await loadInviteSecrets(store, "admin", now)).map((e) => e.invitationId),
    ).toEqual(["fresh"]);
    await store.put("invite-secrets:other", [{ nope: true }, "x", null]);
    expect(await loadInviteSecrets(store, "other")).toEqual([]);
  });

  it("keeps each administrator's secrets apart", async () => {
    const store = memoryStore();
    await saveInviteSecret(store, "one", entry("a"));
    expect(await loadInviteSecrets(store, "two")).toEqual([]);
  });
});

describe("fingerprints", () => {
  it("ignores spaces and case but never accepts an empty one", () => {
    expect(sameFingerprint("AB12 cd34", "ab12cd34")).toBe(true);
    expect(sameFingerprint("ab12", "ab13")).toBe(false);
    expect(sameFingerprint("", "")).toBe(false);
  });
});
