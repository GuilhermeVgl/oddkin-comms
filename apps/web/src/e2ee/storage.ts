/** Minimal async key-value storage; values must be structured-cloneable. */
export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  /** False when nothing survives a reload (private windows, blocked storage). */
  readonly persistent: boolean;
}

export function memoryStore(): KeyValueStore {
  const values = new Map<string, unknown>();
  return {
    persistent: false,
    get: async (key) => values.get(key),
    put: async (key, value) => {
      values.set(key, value);
    },
    remove: async (key) => {
      values.delete(key);
    },
  };
}

const DATABASE = "oddkin-vault";
const STORE = "kv";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("indexedDB failed"));
  });
}

function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const request = action(
          database.transaction(STORE, mode).objectStore(STORE),
        );
        request.onsuccess = () => {
          database.close();
          resolve(request.result);
        };
        request.onerror = () => {
          database.close();
          reject(request.error ?? new Error("indexedDB failed"));
        };
      }),
  );
}

/**
 * IndexedDB storage for wrapped (passphrase-encrypted) key material only.
 * Falls back to memory, and says so, when IndexedDB is unavailable.
 */
export async function browserStore(): Promise<KeyValueStore> {
  try {
    await open().then((database) => database.close());
  } catch {
    return memoryStore();
  }
  return {
    persistent: true,
    get: (key) => run("readonly", (store) => store.get(key)),
    put: async (key, value) => {
      await run("readwrite", (store) => store.put(value, key));
    },
    remove: async (key) => {
      await run("readwrite", (store) => store.delete(key));
    },
  };
}
