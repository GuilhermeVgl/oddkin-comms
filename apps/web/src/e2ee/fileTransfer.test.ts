import { beforeAll, describe, expect, it } from "vitest";
import {
  createCrypto,
  loadSodium,
  createFileSealer,
  FILE_HEADER_LENGTH,
  FILE_RECORD_SIZE,
  openFile,
  type Crypto,
  type FileScope,
} from "@crewstead/crypto";
import {
  chooseSink,
  createByteReader,
  decryptStream,
  sendEncryptedParts,
  TransferError,
  type Sink,
} from "./fileTransfer";

let c: Crypto;
beforeAll(async () => {
  c = await createCrypto(await loadSodium());
});

const scope: FileScope = {
  organizationId: "org",
  domainId: "files",
  authorId: "acc",
  attachmentId: "att",
};
const SIZE = FILE_RECORD_SIZE * 3 + 99;

function sealed(size = SIZE) {
  const device = c.generateDeviceKeys();
  const domainKey = c.generateDomainKey();
  const sealer = createFileSealer(c, {
    domainKey,
    generation: 1,
    scope,
    signerSecretKey: device.signSecretKey,
    size,
  });
  const plain = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) plain[i] = (i * 13 + 5) % 256;
  return { device, domainKey, sealer, plain };
}

async function object(parts: Blob[]): Promise<Uint8Array> {
  const buffers = await Promise.all(parts.map((p) => p.arrayBuffer()));
  const total = buffers.reduce((n, b) => n + b.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const b of buffers) {
    out.set(new Uint8Array(b), at);
    at += b.byteLength;
  }
  return out;
}

async function upload(f: ReturnType<typeof sealed>, partSize: number) {
  const parts: Blob[] = [];
  const partCount = Math.ceil(f.sealer.encryptedSize / partSize);
  await sendEncryptedParts({
    file: new Blob([f.plain as BlobPart]),
    sealer: f.sealer,
    partSize,
    partCount,
    transport: {
      async put(number, body) {
        parts[number - 1] = body;
        return `etag-${number}`;
      },
    },
  });
  return { bytes: await object(parts), parts };
}

function streamOf(
  bytes: Uint8Array,
  chunk: number,
): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream({
    pull(controller) {
      if (at >= bytes.length) controller.close();
      else {
        controller.enqueue(bytes.slice(at, at + chunk));
        at += chunk;
      }
    },
  });
}

function memorySink() {
  const chunks: Uint8Array[] = [];
  const state = { closed: false, aborted: false };
  const sink: Sink = {
    async write(chunk) {
      chunks.push(chunk);
    },
    async close() {
      state.closed = true;
    },
    async abort() {
      state.aborted = true;
    },
  };
  return {
    sink,
    state,
    result: () => {
      const out = new Uint8Array(chunks.reduce((n, x) => n + x.length, 0));
      let at = 0;
      for (const x of chunks) {
        out.set(x, at);
        at += x.length;
      }
      return out;
    },
  };
}

const openHead = (f: ReturnType<typeof sealed>) => async (head: Uint8Array) =>
  openFile(c, {
    keyForGeneration: () => f.domainKey,
    scope,
    signerPublicKey: f.device.signPublicKey,
    head,
  });

describe("encrypted upload in parts", () => {
  it("cuts the ciphertext into parts of exactly the part size, the last one shorter", async () => {
    const f = sealed();
    const partSize = 300_000;
    const { bytes, parts } = await upload(f, partSize);
    expect(bytes.length).toBe(f.sealer.encryptedSize);
    parts.slice(0, -1).forEach((part) => expect(part.size).toBe(partSize));
    expect(parts.at(-1)!.size).toBe(
      bytes.length - partSize * (parts.length - 1),
    );
  });

  it("retries a failed part with the same bytes and fails when it never succeeds", async () => {
    const f = sealed(1000);
    const attempts: Blob[] = [];
    await sendEncryptedParts({
      file: new Blob([f.plain as BlobPart]),
      sealer: f.sealer,
      partCount: 1,
      transport: {
        async put(_n, body) {
          attempts.push(body);
          if (attempts.length < 3) throw new Error("network");
          return "etag";
        },
      },
    });
    expect(attempts).toHaveLength(3);
    expect(attempts[0]).toBe(attempts[2]);

    const g = sealed(1000);
    await expect(
      sendEncryptedParts({
        file: new Blob([g.plain as BlobPart]),
        sealer: g.sealer,
        partCount: 1,
        transport: { put: async () => Promise.reject(new Error("down")) },
      }),
    ).rejects.toThrow("down");
  });

  it("keeps at most two parts in flight", async () => {
    const f = sealed();
    let active = 0;
    let peak = 0;
    await sendEncryptedParts({
      file: new Blob([f.plain as BlobPart]),
      sealer: f.sealer,
      partSize: 100_000,
      partCount: Math.ceil(f.sealer.encryptedSize / 100_000),
      transport: {
        async put(n) {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 2));
          active -= 1;
          return `e${n}`;
        },
      },
    });
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("refuses when the part count does not match the reservation", async () => {
    const f = sealed(1000);
    await expect(
      sendEncryptedParts({
        file: new Blob([f.plain as BlobPart]),
        sealer: f.sealer,
        partCount: 2,
        transport: { put: async () => "e" },
      }),
    ).rejects.toThrow(/part count/);
  });
});

describe("streaming decryption", () => {
  it("round-trips whatever the network chunking is", async () => {
    const f = sealed();
    const { bytes } = await upload(f, 500_000);
    for (const chunk of [7_001, 70_001, 262_161, bytes.length]) {
      const out = memorySink();
      const written = await decryptStream({
        body: streamOf(bytes, chunk),
        openHead: openHead(f),
        sink: out.sink,
      });
      expect(written).toBe(SIZE);
      expect(out.result()).toEqual(f.plain);
      expect(out.state.closed).toBe(true);
    }
  }, 30_000);

  it("aborts the sink on truncation, trailing bytes and tampering, never closing it", async () => {
    const f = sealed();
    const { bytes } = await upload(f, 500_000);
    const cases: [string, Uint8Array][] = [
      ["cut inside a record", bytes.slice(0, bytes.length - 10)],
      [
        "cut on a record boundary",
        bytes.slice(0, FILE_HEADER_LENGTH + 2 * (FILE_RECORD_SIZE + 17)),
      ],
      ["extra bytes", Uint8Array.from([...bytes, 1, 2, 3])],
      ["header only", bytes.slice(0, FILE_HEADER_LENGTH - 5)],
    ];
    const flipped = bytes.slice();
    flipped[FILE_HEADER_LENGTH + 5] =
      (flipped[FILE_HEADER_LENGTH + 5] ?? 0) ^ 1;
    cases.push(["modified record", flipped]);
    for (const [label, broken] of cases) {
      const out = memorySink();
      await expect(
        decryptStream({
          body: streamOf(broken, 100_000),
          openHead: openHead(f),
          sink: out.sink,
        }),
        label,
      ).rejects.toThrow();
      expect(out.state.aborted, label).toBe(true);
      expect(out.state.closed, label).toBe(false);
    }
  });

  it("writes nothing when the manifest is not the uploader's", async () => {
    const f = sealed();
    const { bytes } = await upload(f, 500_000);
    const stranger = c.generateDeviceKeys();
    const out = memorySink();
    await expect(
      decryptStream({
        body: streamOf(bytes, 100_000),
        openHead: async (head) =>
          openFile(c, {
            keyForGeneration: () => f.domainKey,
            scope,
            signerPublicKey: stranger.signPublicKey,
            head,
          }),
        sink: out.sink,
      }),
    ).rejects.toThrow(/bad_signature/);
    expect(out.result()).toHaveLength(0);
  });
});

describe("byte reader", () => {
  it("returns exact sizes across chunk boundaries and short reads at the end", async () => {
    const reader = createByteReader(
      streamOf(
        Uint8Array.from({ length: 10 }, (_, i) => i),
        3,
      ),
    );
    expect([...(await reader.read(4))]).toEqual([0, 1, 2, 3]);
    expect([...(await reader.read(5))]).toEqual([4, 5, 6, 7, 8]);
    expect([...(await reader.read(5))]).toEqual([9]);
    expect(await reader.read(1)).toHaveLength(0);
  });
});

describe("choosing where plaintext goes", () => {
  it("prefers a file the person picks, then private storage, and otherwise says so up front", async () => {
    const picked: string[] = [];
    const sink = await chooseSink("a.bin", {
      showSaveFilePicker: async ({ suggestedName }) => {
        picked.push(suggestedName);
        return {
          createWritable: async () => ({
            write: async () => {},
            close: async () => {},
            abort: async () => {},
          }),
        };
      },
    });
    expect(picked).toEqual(["a.bin"]);
    await sink.write(new Uint8Array(1));

    await expect(chooseSink("a.bin", {})).rejects.toBeInstanceOf(TransferError);
    await expect(chooseSink("a.bin", {})).rejects.toMatchObject({
      reason: "unsupported",
    });
  });

  it("falls back to a temporary file that is removed when the download fails", async () => {
    const removed: string[] = [];
    let delivered = "";
    const sink = await chooseSink("b.bin", {
      getDirectory: async () => ({
        getFileHandle: async () => ({
          createWritable: async () => ({
            write: async () => {},
            close: async () => {},
            abort: async () => {},
          }),
          getFile: async () => new File(["x"], "t"),
        }),
        removeEntry: async (name) => {
          removed.push(name);
        },
      }),
      deliver: (_file, name) => {
        delivered = name;
      },
    });
    await sink.abort();
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatch(/^crewstead-dl-/);
    expect(delivered).toBe("");
  });
});
