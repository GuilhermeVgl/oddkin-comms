import { concat, u32, readU32 } from "./encoding";
import { CryptoError, type ContentContext, type Crypto } from "./index";

/**
 * Encrypted file objects (docs/adr/0019-encrypted-file-bodies.md):
 *
 *   "ODKF" | version(1) | manifest envelope (182) | record 1 | … | record N
 *
 * The manifest is a signed content envelope holding the file key, the
 * secretstream header, the original size, the record size and the record count.
 * Records are secretstream chunks of 256 KiB (the last may be shorter).
 */
export const FILE_MAGIC = new Uint8Array([0x4f, 0x44, 0x4b, 0x46]);
export const FILE_VERSION = 1;
export const FILE_RECORD_SIZE = 262144;
export const FILE_RECORD_OVERHEAD = 17;
export const FILE_MANIFEST_LENGTH = 182;
export const FILE_HEADER_LENGTH = FILE_MAGIC.length + 1 + FILE_MANIFEST_LENGTH;
export const MAX_FILE_BYTES = 500_000_000;
const MANIFEST_PLAINTEXT = 32 + 24 + 8 + 4 + 4;

export function recordCountFor(size: number): number {
  return Math.ceil(size / FILE_RECORD_SIZE);
}

/** Size of the object in the bucket for a file of `size` bytes. */
export function encryptedFileSize(size: number): number {
  return (
    FILE_HEADER_LENGTH + size + FILE_RECORD_OVERHEAD * recordCountFor(size)
  );
}

/** Inverse of encryptedFileSize; null when no file produces that size. */
export function originalFileSize(encrypted: number): number | null {
  const body = encrypted - FILE_HEADER_LENGTH;
  if (!Number.isInteger(body) || body <= FILE_RECORD_OVERHEAD) return null;
  const records = Math.ceil(body / (FILE_RECORD_SIZE + FILE_RECORD_OVERHEAD));
  const size = body - FILE_RECORD_OVERHEAD * records;
  return size >= 1 && recordCountFor(size) === records ? size : null;
}

/** What binds a file object to one attachment, author and key domain. */
export type FileScope = {
  organizationId: string;
  domainId: string;
  authorId: string;
  attachmentId: string;
};

function manifestContext(scope: FileScope): ContentContext {
  return {
    organizationId: scope.organizationId,
    domainId: scope.domainId,
    resourceId: `at:${scope.attachmentId}:manifest`,
    authorId: scope.authorId,
    revision: 1,
  };
}

function bodyContext(scope: FileScope): ContentContext {
  return {
    ...manifestContext(scope),
    resourceId: `at:${scope.attachmentId}:body`,
  };
}

function u64(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value));
  return bytes;
}

/** Ciphertext length of record `index` of a file of `size` bytes. */
export function recordLength(size: number, index: number): number {
  const count = recordCountFor(size);
  const plain =
    index < count - 1
      ? FILE_RECORD_SIZE
      : size - (count - 1) * FILE_RECORD_SIZE;
  return plain + FILE_RECORD_OVERHEAD;
}

export type FileSealer = {
  /** Bytes that start the object: magic, version and signed manifest. */
  prefix: Uint8Array;
  recordCount: number;
  encryptedSize: number;
  /** Seals the next record; chunks must be 256 KiB except the last. */
  seal(plain: Uint8Array): Uint8Array;
};

export function createFileSealer(
  crypto: Crypto,
  input: {
    domainKey: Uint8Array;
    generation: number;
    scope: FileScope;
    signerSecretKey: Uint8Array;
    size: number;
  },
): FileSealer {
  if (
    !Number.isInteger(input.size) ||
    input.size < 1 ||
    input.size > MAX_FILE_BYTES
  ) {
    throw new CryptoError("malformed");
  }
  const count = recordCountFor(input.size);
  const fileKey = crypto.generateDomainKey();
  const stream = crypto.createFileEncryptor(fileKey, bodyContext(input.scope));
  const envelope = crypto.encryptContent({
    key: input.domainKey,
    generation: input.generation,
    context: manifestContext(input.scope),
    plaintext: concat(
      fileKey,
      stream.header,
      u64(input.size),
      u32(FILE_RECORD_SIZE),
      u32(count),
    ),
    signerSecretKey: input.signerSecretKey,
  });
  if (envelope.length !== FILE_MANIFEST_LENGTH)
    throw new CryptoError("malformed");
  let index = 0;
  return {
    prefix: concat(FILE_MAGIC, new Uint8Array([FILE_VERSION]), envelope),
    recordCount: count,
    encryptedSize: encryptedFileSize(input.size),
    seal(plain) {
      if (
        index >= count ||
        plain.length !== recordLength(input.size, index) - FILE_RECORD_OVERHEAD
      ) {
        throw new CryptoError("malformed");
      }
      const final = index === count - 1;
      index += 1;
      return stream.push(plain, final);
    },
  };
}

export type FileOpener = {
  /** Original size, verified against the signed manifest. */
  size: number;
  recordCount: number;
  /** Ciphertext length of the next record to open. */
  nextRecordLength(): number;
  /** Opens the next record; throws on any change, swap, reorder or excess. */
  open(record: Uint8Array): Uint8Array;
  /** Throws unless every record was opened (detects truncation). */
  finish(): void;
};

/**
 * Reads the head of an object. The manifest signature is verified before
 * anything else, so a plaintext byte is only produced for an object whose
 * manifest the uploader signed for this very attachment.
 */
export function openFile(
  crypto: Crypto,
  input: {
    keyForGeneration: (generation: number) => Uint8Array | undefined;
    scope: FileScope;
    signerPublicKey: Uint8Array;
    head: Uint8Array;
  },
): FileOpener {
  const { head } = input;
  if (head.length < FILE_HEADER_LENGTH) throw new CryptoError("malformed");
  for (let i = 0; i < FILE_MAGIC.length; i += 1) {
    if (head[i] !== FILE_MAGIC[i]) throw new CryptoError("malformed");
  }
  if (head[FILE_MAGIC.length] !== FILE_VERSION)
    throw new CryptoError("malformed");
  const plain = crypto.decryptContent({
    keyForGeneration: input.keyForGeneration,
    context: manifestContext(input.scope),
    envelope: head.subarray(FILE_MAGIC.length + 1, FILE_HEADER_LENGTH),
    signerPublicKey: input.signerPublicKey,
  });
  if (plain.length !== MANIFEST_PLAINTEXT) throw new CryptoError("malformed");
  const fileKey = plain.subarray(0, 32);
  const streamHeader = plain.subarray(32, 56);
  const view = new DataView(plain.buffer, plain.byteOffset + 56, 16);
  const size = Number(view.getBigUint64(0));
  const recordSize = readU32(plain, 64);
  const count = readU32(plain, 68);
  if (
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > MAX_FILE_BYTES ||
    recordSize !== FILE_RECORD_SIZE ||
    count !== recordCountFor(size)
  ) {
    throw new CryptoError("malformed");
  }
  const decryptor = crypto.createFileDecryptor(
    fileKey.slice(),
    streamHeader.slice(),
    bodyContext(input.scope),
  );
  let index = 0;
  let produced = 0;
  return {
    size,
    recordCount: count,
    nextRecordLength: () => recordLength(size, Math.min(index, count - 1)),
    open(record) {
      if (index >= count || record.length !== recordLength(size, index)) {
        throw new CryptoError("malformed");
      }
      const result = decryptor.pull(record);
      const last = index === count - 1;
      if (result.final !== last) throw new CryptoError("malformed");
      index += 1;
      produced += result.plaintext.length;
      return result.plaintext;
    },
    finish() {
      if (index !== count || produced !== size)
        throw new CryptoError("malformed");
    },
  };
}
