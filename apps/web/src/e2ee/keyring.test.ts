import { createApiClient, type KeyDomain } from "@oddkin/api-client";
import {
  createCrypto,
  loadSodium,
  toBase64Url,
  type Crypto,
  type DeviceKeys,
} from "@oddkin/crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { Keyring, UntrustedDeviceError } from "./keyring";
import type { Vault } from "./vault";

let c: Crypto;
beforeAll(async () => {
  c = await createCrypto(await loadSodium());
});

type Person = {
  kind?: "device" | "recovery";
  account: string;
  deviceId: string;
  keys: DeviceKeys;
  certificate: Uint8Array;
  authorizer?: string;
};

/** A tiny in-memory server speaking the key-directory endpoints the keyring uses. */
function fakeServer(
  domain: KeyDomain,
  devices: Person[],
  known: Person[] = [],
) {
  const envelopes: {
    generation: number;
    recipient: string;
    signer: string;
    sealed: string;
    signature: string;
  }[] = [];
  const record = (p: Person) => ({
    deviceId: p.deviceId,
    accountId: p.account,
    email: `${p.account}@example.test`,
    kind: p.kind ?? "device",
    state: "active",
    signPublicKey: toBase64Url(p.keys.signPublicKey),
    boxPublicKey: toBase64Url(p.keys.boxPublicKey),
    certificate: toBase64Url(p.certificate),
    ...(p.authorizer === undefined ? {} : { authorizerDeviceId: p.authorizer }),
  });
  const handler =
    (me: Person): typeof fetch =>
    async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      const path = new URL(request.url).pathname;
      const json = (body: unknown, status = 200) =>
        Response.json(body, { status });
      const device = /\/devices\/([^/]+)$/.exec(path);
      if (device !== null) {
        const found = [...devices, ...known].find(
          (p) => p.deviceId === device[1],
        );
        return found === undefined
          ? new Response(null, { status: 404 })
          : json(record(found));
      }
      if (path.endsWith("/recovery/gaps")) {
        const holders = (generation: number) =>
          new Set(
            envelopes
              .filter((e) => e.generation === generation)
              .map((e) => e.recipient),
          );
        const gaps = [];
        for (
          let generation = 1;
          generation <= domain.currentGeneration;
          generation += 1
        ) {
          for (const device of devices) {
            if (!holders(generation).has(device.deviceId)) {
              gaps.push({
                domainId: domain.id,
                kind: "work",
                generation,
                device: record(device),
              });
            }
          }
        }
        return json(gaps);
      }
      if (path.endsWith("/recovery-envelopes")) {
        const recovery = devices
          .filter((p) => p.kind === "recovery")
          .map((p) => p.deviceId);
        return json(
          envelopes
            .filter((e) => recovery.includes(e.recipient))
            .map((e) => ({
              generation: e.generation,
              recipientDeviceId: e.recipient,
              signerDeviceId: e.signer,
              sealed: e.sealed,
              signature: e.signature,
            })),
        );
      }
      if (path.endsWith("/authorized-devices"))
        return json(devices.map(record));
      if (path.endsWith("/recipients"))
        return json(
          envelopes.map((e) => ({
            generation: e.generation,
            deviceId: e.recipient,
          })),
        );
      if (request.method === "GET" && path.endsWith("/envelopes")) {
        const mine = devices
          .filter((p) => p.account === me.account)
          .map((p) => p.deviceId);
        return json(
          envelopes
            .filter((e) => mine.includes(e.recipient))
            .map((e) => ({
              generation: e.generation,
              recipientDeviceId: e.recipient,
              signerDeviceId: e.signer,
              sealed: e.sealed,
              signature: e.signature,
            })),
        );
      }
      if (
        request.method === "POST" &&
        (path.endsWith("/generations") ||
          path.endsWith("/envelopes") ||
          path.endsWith("/recovery-grants"))
      ) {
        const body = (await request.json()) as {
          generation: number;
          signerDeviceId: string;
          envelopes: {
            recipientDeviceId: string;
            sealed: string;
            signature: string;
          }[];
        };
        for (const e of body.envelopes) {
          envelopes.push({
            generation: body.generation,
            recipient: e.recipientDeviceId,
            signer: body.signerDeviceId,
            sealed: e.sealed,
            signature: e.signature,
          });
        }
        if (path.endsWith("/generations"))
          domain.currentGeneration = body.generation;
        domain.state = "ok";
        return json({ ...domain });
      }
      return new Response(null, { status: 404 });
    };
  return { envelopes, handler };
}

function person(
  root: DeviceKeys,
  account: string,
  deviceId: string,
  signer?: { keys: DeviceKeys; id: string },
): Person {
  const keys = c.generateDeviceKeys();
  const certificate = c.signDeviceCertificate(
    (signer?.keys ?? root).signSecretKey,
    {
      accountId: account,
      deviceId,
      signPublicKey: keys.signPublicKey,
      boxPublicKey: keys.boxPublicKey,
    },
  );
  return {
    account,
    deviceId,
    keys,
    certificate,
    ...(signer === undefined ? {} : { authorizer: signer.id }),
  };
}

function ring(
  server: ReturnType<typeof fakeServer>,
  me: Person,
  root: DeviceKeys,
  recovery?: Person,
) {
  const client = createApiClient("http://api.test", server.handler(me));
  const vault = {
    deviceKeys: () => me.keys,
    unlocked: true,
    recoveryKeys: () =>
      recovery === undefined
        ? undefined
        : {
            deviceId: recovery.deviceId,
            boxPublicKey: recovery.keys.boxPublicKey,
            boxSecretKey: recovery.keys.boxSecretKey,
          },
  } as unknown as Vault;
  return new Keyring({
    client,
    crypto: c,
    vault,
    pinnedRoot: root.signPublicKey,
    accountId: me.account,
    deviceId: me.deviceId,
    csrf: () => "csrf",
  });
}

const newDomain = (): KeyDomain => ({
  id: "domain-1",
  organizationId: "org-1",
  projectId: "project-1",
  kind: "work",
  currentGeneration: 0,
  state: "pending_keys",
  writable: false,
});

describe("keyring stewardship", () => {
  it("publishes generation 1 for the authorized devices, and each opens only its own envelope", async () => {
    const root = c.generateDeviceKeys();
    const ana = person(root, "ana", "d-ana");
    const bruno = person(root, "bruno", "d-bruno");
    const domain = newDomain();
    const server = fakeServer(domain, [ana, bruno]);
    const anaRing = ring(server, ana, root);
    expect(await anaRing.maintain({ ...domain })).toBe("published");
    const anaKey = anaRing.keyFor("domain-1", 1);
    expect(anaKey).toBeDefined();
    const brunoRing = ring(server, bruno, root);
    await brunoRing.loadKeys({ ...domain });
    expect(brunoRing.keyFor("domain-1", 1)).toEqual(anaKey);
  });

  it("rotates after a revocation without losing history, and the removed device never gets the new key", async () => {
    const root = c.generateDeviceKeys();
    const ana = person(root, "ana", "d-ana");
    const bruno = person(root, "bruno", "d-bruno");
    const domain = newDomain();
    const devices = [ana, bruno];
    const server = fakeServer(domain, devices);
    const anaRing = ring(server, ana, root);
    await anaRing.maintain({ ...domain });
    const first = anaRing.keyFor("domain-1", 1);
    devices.splice(devices.indexOf(bruno), 1);
    domain.state = "rotation_required";
    expect(await anaRing.maintain({ ...domain })).toBe("published");
    const second = anaRing.keyFor("domain-1", 2);
    expect(second).toBeDefined();
    expect(second).not.toEqual(first);
    expect(anaRing.keyFor("domain-1", 1)).toEqual(first);
    const sealedForBruno = server.envelopes.filter(
      (e) => e.generation === 2 && e.recipient === "d-bruno",
    );
    expect(sealedForBruno).toHaveLength(0);
  });

  it("hands the history to a device that joined later, which can then read old content", async () => {
    const root = c.generateDeviceKeys();
    const ana = person(root, "ana", "d-ana");
    const domain = newDomain();
    const devices = [ana];
    const server = fakeServer(domain, devices);
    const anaRing = ring(server, ana, root);
    await anaRing.maintain({ ...domain });
    const key = anaRing.keyFor("domain-1", 1) as Uint8Array;
    const envelope = c.encryptContent({
      key,
      generation: 1,
      context: {
        organizationId: "org-1",
        domainId: "domain-1",
        resourceId: "wi:1:title",
        authorId: "ana",
        revision: 1,
      },
      plaintext: new TextEncoder().encode("segredo antigo"),
      signerSecretKey: ana.keys.signSecretKey,
    });
    const carla = person(root, "carla", "d-carla");
    devices.push(carla);
    domain.state = "pending_keys";
    expect(await anaRing.maintain({ ...domain })).toBe("granted");
    const carlaRing = ring(server, carla, root);
    await carlaRing.loadKeys({ ...domain });
    const opened = c.decryptContent({
      keyForGeneration: (generation) =>
        carlaRing.keyFor("domain-1", generation),
      context: {
        organizationId: "org-1",
        domainId: "domain-1",
        resourceId: "wi:1:title",
        authorId: "ana",
        revision: 1,
      },
      envelope,
      signerPublicKey: ana.keys.signPublicKey,
    });
    expect(new TextDecoder().decode(opened)).toBe("segredo antigo");
  });

  it("refuses to seal to a device whose certificate the pinned root did not vouch for", async () => {
    const root = c.generateDeviceKeys();
    const serverRoot = c.generateDeviceKeys();
    const ana = person(root, "ana", "d-ana");
    const planted = person(serverRoot, "mallory", "d-planted");
    const domain = newDomain();
    const server = fakeServer(domain, [ana, planted]);
    await expect(
      ring(server, ana, root).maintain({ ...domain }),
    ).rejects.toBeInstanceOf(UntrustedDeviceError);
    expect(server.envelopes).toHaveLength(0);
  });

  it("ignores envelopes signed by a device it cannot trust", async () => {
    const root = c.generateDeviceKeys();
    const ana = person(root, "ana", "d-ana");
    const intruder = person(c.generateDeviceKeys(), "mallory", "d-mallory");
    const domain = {
      ...newDomain(),
      currentGeneration: 1,
      state: "ok" as const,
    };
    const devices = [ana, intruder];
    const server = fakeServer(domain, devices);
    const forgedKey = c.generateDomainKey();
    const sealed = c.sealDomainKey({
      key: forgedKey,
      domainId: "domain-1",
      generation: 1,
      recipientDeviceId: "d-ana",
      recipientBoxPublicKey: ana.keys.boxPublicKey,
      signerSecretKey: intruder.keys.signSecretKey,
    });
    server.envelopes.push({
      generation: 1,
      recipient: "d-ana",
      signer: "d-mallory",
      sealed: toBase64Url(sealed.sealed),
      signature: toBase64Url(sealed.signature),
    });
    const anaRing = ring(server, ana, root);
    await anaRing.loadKeys(domain);
    expect(anaRing.keyFor("domain-1", 1)).toBeUndefined();
  });

  it("restores history for a device that lost it, using only the recovery identity", async () => {
    const root = c.generateDeviceKeys();
    const ana = person(root, "ana", "d-ana");
    const admin = person(root, "admin", "d-admin");
    const recovery = {
      ...person(root, "admin", "d-recovery"),
      kind: "recovery" as const,
    };
    const domain = newDomain();
    const devices = [ana, recovery];
    const server = fakeServer(domain, devices, [admin]);
    const anaRing = ring(server, ana, root);
    await anaRing.maintain({ ...domain });
    const key = anaRing.keyFor("domain-1", 1) as Uint8Array;

    // Bia lost every device; her new one is authorized but holds nothing, and nobody else can help.
    const bia = person(root, "bia", "d-bia");
    devices.push(bia);
    const adminRing = ring(server, admin, root, recovery);
    const result = await adminRing.recoverGaps();
    expect(result).toEqual({ granted: 1, failed: 0 });
    const biaRing = ring(server, bia, root);
    await biaRing.loadKeys({ ...domain });
    expect(biaRing.keyFor("domain-1", 1)).toEqual(key);
  });

  it("does nothing without the recovery identity's keys", async () => {
    const root = c.generateDeviceKeys();
    const ana = person(root, "ana", "d-ana");
    const admin = person(root, "admin", "d-admin");
    const recovery = {
      ...person(root, "admin", "d-recovery"),
      kind: "recovery" as const,
    };
    const domain = newDomain();
    const devices = [ana, recovery];
    const server = fakeServer(domain, devices);
    await ring(server, ana, root).maintain({ ...domain });
    devices.push(person(root, "bia", "d-bia"));
    const result = await ring(server, admin, root).recoverGaps();
    expect(result.granted).toBe(0);
    expect(result.failed).toBe(1);
  });
});
