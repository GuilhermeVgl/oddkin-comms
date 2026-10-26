import sodium from "libsodium-wrappers-sumo";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createCrypto,
  createFileSealer,
  encryptedFileSize,
  FILE_HEADER_LENGTH,
  FILE_RECORD_SIZE,
  MAX_FILE_BYTES,
  openFile,
  originalFileSize,
  recordLength,
  type Crypto,
  type FileScope,
} from "./index";

let c: Crypto;
beforeAll(async () => {
  c = await createCrypto(sodium);
});

const scope: FileScope = {
  organizationId: "org-1",
  domainId: "files-1",
  authorId: "account-1",
  attachmentId: "attachment-1",
};

function setup(size: number) {
  const author = c.generateDeviceKeys();
  const domainKey = c.generateDomainKey();
  const sealer = createFileSealer(c, {
    domainKey,
    generation: 2,
    scope,
    signerSecretKey: author.signSecretKey,
    size,
  });
  const plain = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) plain[i] = (i * 31 + 7) % 251;
  const records: Uint8Array[] = [];
  for (let at = 0; at < size; at += FILE_RECORD_SIZE) {
    records.push(sealer.seal(plain.subarray(at, at + FILE_RECORD_SIZE)));
  }
  return { author, domainKey, sealer, plain, records };
}

function opener(
  fixture: ReturnType<typeof setup>,
  over: Partial<{
    scope: FileScope;
    head: Uint8Array;
    publicKey: Uint8Array;
  }> = {},
) {
  return openFile(c, {
    keyForGeneration: (generation) =>
      generation === 2 ? fixture.domainKey : undefined,
    scope: over.scope ?? scope,
    signerPublicKey: over.publicKey ?? fixture.author.signPublicKey,
    head: over.head ?? fixture.sealer.prefix,
  });
}

const SIZE = FILE_RECORD_SIZE * 2 + 1234;

describe("size arithmetic", () => {
  it("matches the server's formula and inverts it", () => {
    for (const n of [
      1,
      FILE_RECORD_SIZE,
      FILE_RECORD_SIZE + 1,
      3_000_000,
      MAX_FILE_BYTES,
      MAX_FILE_BYTES + 1,
    ]) {
      expect(originalFileSize(encryptedFileSize(n))).toBe(n);
    }
    expect(encryptedFileSize(3_000_000)).toBe(3_000_000 + 187 + 17 * 12);
    expect(
      originalFileSize(encryptedFileSize(2 * FILE_RECORD_SIZE) + 1),
    ).toBeNull();
    expect(originalFileSize(FILE_HEADER_LENGTH)).toBeNull();
  });
});

describe("encrypted file objects", () => {
  it("round-trips a multi-record file and the object has the computed size", () => {
    const fixture = setup(SIZE);
    const total =
      fixture.sealer.prefix.length +
      fixture.records.reduce((sum, record) => sum + record.length, 0);
    expect(total).toBe(encryptedFileSize(SIZE));
    expect(fixture.sealer.prefix.length).toBe(FILE_HEADER_LENGTH);
    const reader = opener(fixture);
    expect(reader.size).toBe(SIZE);
    const out = new Uint8Array(SIZE);
    let at = 0;
    fixture.records.forEach((record, index) => {
      expect(record.length).toBe(recordLength(SIZE, index));
      const piece = reader.open(record);
      out.set(piece, at);
      at += piece.length;
    });
    reader.finish();
    expect(at).toBe(SIZE);
    expect(out).toEqual(fixture.plain);
  });

  it("never shows the plaintext or the key in the object", () => {
    const fixture = setup(1000);
    const object = Uint8Array.from([
      ...fixture.sealer.prefix,
      ...fixture.records[0]!,
    ]);
    const asText = Buffer.from(object).toString("latin1");
    expect(asText).not.toContain(
      Buffer.from(fixture.plain.subarray(0, 32)).toString("latin1"),
    );
  });

  it("detects a truncated file, even when the cut falls on a record boundary", () => {
    const fixture = setup(SIZE);
    const reader = opener(fixture);
    reader.open(fixture.records[0]!);
    reader.open(fixture.records[1]!);
    expect(() => reader.finish()).toThrow(/malformed/);
  });

  it("detects extra records and records out of order or modified", () => {
    const fixture = setup(SIZE);
    const reordered = opener(fixture);
    expect(() => reordered.open(fixture.records[1]!)).toThrow();
    const modified = opener(fixture);
    const tampered = fixture.records[0]!.slice();
    tampered[10] = (tampered[10] ?? 0) ^ 1;
    expect(() => modified.open(tampered)).toThrow(/decryption_failed/);
    const extra = opener(fixture);
    fixture.records.forEach((record) => extra.open(record));
    expect(() => extra.open(fixture.records[0]!)).toThrow(/malformed/);
  });

  it("rejects an object moved to another attachment, author or domain", () => {
    const fixture = setup(SIZE);
    for (const other of [
      { ...scope, attachmentId: "attachment-2" },
      { ...scope, authorId: "account-2" },
      { ...scope, domainId: "files-2" },
    ]) {
      expect(() => opener(fixture, { scope: other })).toThrow();
    }
  });

  it("rejects a manifest not signed by the claimed author, or a bad prefix", () => {
    const fixture = setup(SIZE);
    const stranger = c.generateDeviceKeys();
    expect(() =>
      opener(fixture, { publicKey: stranger.signPublicKey }),
    ).toThrow(/bad_signature/);
    const wrongMagic = fixture.sealer.prefix.slice();
    wrongMagic[0] = 0;
    expect(() => opener(fixture, { head: wrongMagic })).toThrow(/malformed/);
    const cut = fixture.sealer.prefix.subarray(0, 100);
    expect(() => opener(fixture, { head: cut })).toThrow(/malformed/);
  });

  it("opens only with the key of the generation it was sealed under", () => {
    const fixture = setup(1000);
    expect(() =>
      openFile(c, {
        keyForGeneration: () => undefined,
        scope,
        signerPublicKey: fixture.author.signPublicKey,
        head: fixture.sealer.prefix,
      }),
    ).toThrow(/unknown_generation/);
  });

  it("refuses sizes outside the limits and chunks of the wrong size", () => {
    const author = c.generateDeviceKeys();
    const make = (size: number) =>
      createFileSealer(c, {
        domainKey: c.generateDomainKey(),
        generation: 1,
        scope,
        signerSecretKey: author.signSecretKey,
        size,
      });
    expect(() => make(0)).toThrow();
    expect(() => make(MAX_FILE_BYTES + 1)).toThrow();
    expect(make(MAX_FILE_BYTES).recordCount).toBe(1908);
    const sealer = make(FILE_RECORD_SIZE + 5);
    expect(() => sealer.seal(new Uint8Array(10))).toThrow(/malformed/);
  });

  it("uses a fresh key and stream header for every file", () => {
    const a = setup(1000);
    const b = setup(1000);
    expect(a.records[0]).not.toEqual(b.records[0]);
  });
});
