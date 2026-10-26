/**
 * Browser storage that never throws: it can be unavailable (private windows,
 * blocked site data) or full. Reads then answer null and writes are dropped,
 * so every caller keeps working without it.
 */
export type SafeStorage = {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  getJSON(key: string): unknown;
  setJSON(key: string, value: unknown): void;
};

export function createSafeStorage(
  pick: () => Storage | undefined,
): SafeStorage {
  const storage = (): Storage | undefined => {
    try {
      return pick();
    } catch {
      return undefined;
    }
  };
  const get = (key: string): string | null => {
    try {
      return storage()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const set = (key: string, value: string) => {
    try {
      storage()?.setItem(key, value);
    } catch {
      // The value just lasts until the page closes.
    }
  };
  return {
    get,
    set,
    remove(key) {
      try {
        storage()?.removeItem(key);
      } catch {
        // Nothing to clean up.
      }
    },
    getJSON(key) {
      const raw = get(key);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return null;
      }
    },
    setJSON(key, value) {
      set(key, JSON.stringify(value));
    },
  };
}

/** The page's localStorage, safe to call anywhere. */
export const localStore = createSafeStorage(() => window.localStorage);
