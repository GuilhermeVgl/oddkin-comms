import {
  FILE_HEADER_LENGTH,
  FILE_RECORD_SIZE,
  type FileOpener,
  type FileSealer,
} from "@crewstead/crypto";

/** Parts hold ciphertext, so the transport part size is independent of the record size. */
export const DEFAULT_PART_SIZE = 8 << 20;
const MAX_PARTS_IN_FLIGHT = 2;
const PART_ATTEMPTS = 3;

export type PartTransport = {
  /** Sends one part and returns its ETag; the same bytes are sent again on retry. */
  put(partNumber: number, body: Blob): Promise<string>;
};

/**
 * Reads the file in record-sized slices, encrypts them in order and sends the
 * ciphertext in parts. At most two parts (plus the one being filled) are held
 * in memory, so a 500 MB file never sits in RAM. Returns the ETags in order.
 */
export async function sendEncryptedParts(input: {
  file: Blob;
  sealer: FileSealer;
  partSize?: number;
  partCount: number;
  transport: PartTransport;
  onProgress?: (fraction: number) => void;
}): Promise<string[]> {
  const partSize = input.partSize ?? DEFAULT_PART_SIZE;
  const etags: string[] = new Array<string>(input.partCount);
  const inFlight = new Set<Promise<void>>();
  let failure: unknown = null;
  let sentBytes = 0;
  const total = input.sealer.encryptedSize;

  const launch = async (partNumber: number, pieces: Uint8Array[]) => {
    while (inFlight.size >= MAX_PARTS_IN_FLIGHT) await Promise.race(inFlight);
    if (failure !== null) throw failure;
    const body = new Blob(pieces as BlobPart[]);
    const task = (async () => {
      let lastError: unknown = null;
      for (let attempt = 0; attempt < PART_ATTEMPTS; attempt += 1) {
        try {
          etags[partNumber - 1] = await input.transport.put(partNumber, body);
          sentBytes += body.size;
          input.onProgress?.(Math.min(1, sentBytes / total));
          return;
        } catch (error) {
          lastError = error;
        }
      }
      failure = lastError ?? new Error("part rejected");
    })().finally(() => inFlight.delete(task));
    inFlight.add(task);
  };

  let pieces: Uint8Array[] = [input.sealer.prefix];
  let filled = input.sealer.prefix.length;
  let partNumber = 0;
  const flush = async (force: boolean) => {
    while (filled >= partSize || (force && filled > 0)) {
      // Cut exactly partSize bytes for every part but the last.
      const take = Math.min(filled, partSize);
      const out: Uint8Array[] = [];
      let need = take;
      const rest: Uint8Array[] = [];
      for (const piece of pieces) {
        if (need === 0) rest.push(piece);
        else if (piece.length <= need) {
          out.push(piece);
          need -= piece.length;
        } else {
          out.push(piece.subarray(0, need));
          rest.push(piece.subarray(need));
          need = 0;
        }
      }
      pieces = rest;
      filled -= take;
      partNumber += 1;
      await launch(partNumber, out);
    }
  };

  for (let at = 0; at < input.file.size; at += FILE_RECORD_SIZE) {
    const slice = input.file.slice(at, at + FILE_RECORD_SIZE);
    const record = input.sealer.seal(new Uint8Array(await slice.arrayBuffer()));
    pieces.push(record);
    filled += record.length;
    await flush(false);
  }
  await flush(true);
  await Promise.all(inFlight);
  if (failure !== null) throw failure;
  if (partNumber !== input.partCount)
    throw new Error("the part count does not match the reservation");
  return etags;
}

/** Pulls exact byte counts out of a stream whose chunks have arbitrary sizes. */
export function createByteReader(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  let buffer: Uint8Array[] = [];
  let buffered = 0;
  let done = false;
  return {
    /** Returns exactly `length` bytes, fewer only at the end of the stream. */
    async read(length: number): Promise<Uint8Array> {
      while (buffered < length && !done) {
        const next = await reader.read();
        if (next.done) done = true;
        else if (next.value.length > 0) {
          buffer.push(next.value);
          buffered += next.value.length;
        }
      }
      const out = new Uint8Array(Math.min(length, buffered));
      let at = 0;
      while (at < out.length) {
        const head = buffer[0] as Uint8Array;
        const take = Math.min(head.length, out.length - at);
        out.set(head.subarray(0, take), at);
        at += take;
        if (take === head.length) buffer.shift();
        else buffer[0] = head.subarray(take);
      }
      buffered -= out.length;
      return out;
    },
    async cancel() {
      buffer = [];
      await reader.cancel().catch(() => undefined);
    },
  };
}

export type Sink = {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  /** Discards everything written so far. */
  abort(): Promise<void>;
};

export class TransferError extends Error {
  constructor(
    readonly reason: "truncated" | "extra_data" | "unsupported",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Decrypts a downloaded object into a sink, one record at a time. The
 * manifest is verified (by `openHead`) before any plaintext is written. On any
 * failure the sink is aborted, so a partial file is never presented as valid.
 */
export async function decryptStream(input: {
  body: ReadableStream<Uint8Array>;
  openHead: (head: Uint8Array) => Promise<FileOpener>;
  sink: Sink;
  onProgress?: ((fraction: number) => void) | undefined;
}): Promise<number> {
  const bytes = createByteReader(input.body);
  try {
    const head = await bytes.read(FILE_HEADER_LENGTH);
    if (head.length < FILE_HEADER_LENGTH)
      throw new TransferError(
        "truncated",
        "the object is shorter than its header",
      );
    const opener = await input.openHead(head);
    let written = 0;
    for (let index = 0; index < opener.recordCount; index += 1) {
      const record = await bytes.read(opener.nextRecordLength());
      if (record.length !== opener.nextRecordLength())
        throw new TransferError(
          "truncated",
          "the object ends before its last record",
        );
      const plain = opener.open(record);
      await input.sink.write(plain);
      written += plain.length;
      input.onProgress?.(written / opener.size);
    }
    if ((await bytes.read(1)).length !== 0)
      throw new TransferError("extra_data", "bytes follow the last record");
    opener.finish();
    await input.sink.close();
    return written;
  } catch (error) {
    await bytes.cancel();
    await input.sink.abort().catch(() => undefined);
    throw error;
  }
}

type SaveFilePicker = (options: { suggestedName: string }) => Promise<{
  createWritable(): Promise<{
    write(chunk: Uint8Array): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }>;
}>;

type OpfsDirectory = {
  getFileHandle(
    name: string,
    options: { create: boolean },
  ): Promise<{
    createWritable(): Promise<{
      write(chunk: Uint8Array): Promise<void>;
      close(): Promise<void>;
      abort(): Promise<void>;
    }>;
    getFile(): Promise<File>;
  }>;
  removeEntry(name: string): Promise<void>;
};

const OPFS_PREFIX = "crewstead-dl-";

/**
 * Picks where plaintext goes without ever holding the file in memory: a file
 * the person chooses (File System Access API), or a temporary file in the
 * origin's private storage handed over as a disk-backed File. Throws
 * `unsupported` before anything is downloaded when neither exists.
 */
export async function chooseSink(
  name: string,
  env: {
    showSaveFilePicker?: SaveFilePicker | undefined;
    getDirectory?: (() => Promise<OpfsDirectory>) | undefined;
    deliver?: ((file: File, name: string) => void) | undefined;
  },
): Promise<Sink> {
  if (env.showSaveFilePicker !== undefined) {
    const handle = await env.showSaveFilePicker({ suggestedName: name });
    const writable = await handle.createWritable();
    return {
      write: (chunk) => writable.write(chunk),
      close: () => writable.close(),
      abort: () => writable.abort(),
    };
  }
  if (env.getDirectory !== undefined && env.deliver !== undefined) {
    const directory = await env.getDirectory();
    const temp = `${OPFS_PREFIX}${crypto.randomUUID()}`;
    const handle = await directory.getFileHandle(temp, { create: true });
    const writable = await handle.createWritable();
    const deliver = env.deliver;
    return {
      write: (chunk) => writable.write(chunk),
      async close() {
        await writable.close();
        deliver(await handle.getFile(), name);
        // The File stays readable for the download; the entry goes on the next run.
      },
      async abort() {
        await writable.abort().catch(() => undefined);
        await directory.removeEntry(temp).catch(() => undefined);
      },
    };
  }
  throw new TransferError(
    "unsupported",
    "this browser cannot write large files in parts",
  );
}

/** Removes temporary downloads left by earlier runs. */
export async function cleanTemporaryDownloads(
  directory: OpfsDirectory & { keys?: () => AsyncIterable<string> },
): Promise<void> {
  if (directory.keys === undefined) return;
  for await (const name of directory.keys()) {
    if (name.startsWith(OPFS_PREFIX))
      await directory.removeEntry(name).catch(() => undefined);
  }
}
