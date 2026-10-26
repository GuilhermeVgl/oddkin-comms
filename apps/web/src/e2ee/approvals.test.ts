import type { Device, PendingDevice } from "@crewstead/api-client";
import { toBase64Url } from "@crewstead/crypto";
import { describe, expect, it } from "vitest";
import { approvalOf, collectApprovals, matchInviteSecret } from "./approvals";
import type { InviteSecret } from "./invitations";
import type { PendingApproval } from "./types";

const key = (byte: number) => toBase64Url(new Uint8Array(32).fill(byte));

function device(id: string, state: Device["state"], proof?: string): Device {
  return {
    id,
    name: `device ${id}`,
    kind: "device",
    state,
    signPublicKey: key(1),
    boxPublicKey: key(2),
    ...(proof === undefined ? {} : { proof }),
  };
}

const pendingOf = (
  id: string,
  accountId = "acc-1",
  email = "a@example.test",
): PendingDevice => ({ device: device(id, "pending"), accountId, email });

const fingerprintOf = (sign: string) => `fp:${sign.slice(0, 4)}`;
const account = { id: "me", email: "me@example.test" };

describe("approvalOf", () => {
  it("copies the device and attaches the fingerprint", () => {
    const row = approvalOf(pendingOf("d1"), fingerprintOf);
    expect(row).toEqual({
      deviceId: "d1",
      accountId: "acc-1",
      email: "a@example.test",
      name: "device d1",
      signPublicKey: key(1),
      boxPublicKey: key(2),
      fingerprint: fingerprintOf(key(1)),
    });
    expect("proof" in row).toBe(false);
  });

  it("keeps the invitation proof when the device carries one", () => {
    const pending: PendingDevice = {
      ...pendingOf("d1"),
      device: device("d1", "pending", "proof-1"),
    };
    expect(approvalOf(pending, fingerprintOf).proof).toBe("proof-1");
  });
});

describe("collectApprovals", () => {
  it("lists the organization's pending devices before the account's own", () => {
    const rows = collectApprovals({
      adminPending: [pendingOf("org-1")],
      ownDevices: [device("own-1", "pending")],
      account,
      fingerprintOf,
    });
    expect(rows.map((row) => row.deviceId)).toEqual(["org-1", "own-1"]);
    expect(rows[1]).toMatchObject({
      accountId: "me",
      email: "me@example.test",
    });
  });

  it("ignores devices that are not pending and lists a device once", () => {
    const rows = collectApprovals({
      adminPending: [pendingOf("same")],
      ownDevices: [
        device("same", "pending"),
        device("active-1", "active"),
        device("revoked-1", "revoked"),
      ],
      account,
      fingerprintOf,
    });
    expect(rows.map((row) => row.deviceId)).toEqual(["same"]);
    expect(rows[0]?.accountId).toBe("acc-1");
  });

  it("is empty when nothing waits", () => {
    expect(
      collectApprovals({
        adminPending: [],
        ownDevices: [],
        account,
        fingerprintOf,
      }),
    ).toEqual([]);
  });
});

describe("matchInviteSecret", () => {
  const entry = (proof: string | undefined, email = "New@Example.test") =>
    ({
      ...approvalOf(
        {
          device: device("d9", "pending", proof),
          accountId: "acc-9",
          email,
        },
        fingerprintOf,
      ),
    }) satisfies PendingApproval;
  const secret = (id: string, email: string): InviteSecret => ({
    invitationId: id,
    email,
    secret: key(7),
    createdAt: 0,
  });

  it("finds nothing for a device without a proof", () => {
    const verify = () => true;
    expect(
      matchInviteSecret(entry(undefined), [secret("i1", "new@example.test")], {
        verifyInvitationProof: verify,
      }),
    ).toBeUndefined();
  });

  it("matches the e-mail case-insensitively and asks the crypto to verify", () => {
    const calls: string[] = [];
    const found = matchInviteSecret(
      entry("p1"),
      [secret("other", "x@example.test"), secret("i1", "new@example.test")],
      {
        verifyInvitationProof: (_s, _sign, _box, proof) => {
          calls.push(proof);
          return true;
        },
      },
    );
    expect(found?.invitationId).toBe("i1");
    expect(calls).toEqual(["p1"]);
  });

  it("rejects a proof that does not verify", () => {
    expect(
      matchInviteSecret(entry("p1"), [secret("i1", "new@example.test")], {
        verifyInvitationProof: () => false,
      }),
    ).toBeUndefined();
  });
});
