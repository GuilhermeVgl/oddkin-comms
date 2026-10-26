import { describe, expect, it } from "vitest";
import { createSafeStorage } from "./safeStorage";

function memory(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

describe("safe storage", () => {
  it("stores and reads strings and JSON", () => {
    const store = createSafeStorage(() => memory());
    const shared = memory();
    const kept = createSafeStorage(() => shared);
    kept.set("a", "1");
    kept.setJSON("b", { ids: ["x"] });
    expect(kept.get("a")).toBe("1");
    expect(kept.getJSON("b")).toEqual({ ids: ["x"] });
    kept.remove("a");
    expect(kept.get("a")).toBeNull();
    expect(store.get("missing")).toBeNull();
  });

  it("answers null for broken JSON instead of throwing", () => {
    const shared = memory();
    shared.setItem("bad", "{not json");
    expect(createSafeStorage(() => shared).getJSON("bad")).toBeNull();
  });

  it("survives storage that throws on every call", () => {
    const hostile = createSafeStorage(() => {
      throw new Error("blocked");
    });
    expect(hostile.get("a")).toBeNull();
    expect(() => hostile.set("a", "1")).not.toThrow();
    expect(() => hostile.remove("a")).not.toThrow();
    expect(hostile.getJSON("a")).toBeNull();

    const full = createSafeStorage(
      () =>
        ({
          getItem: () => {
            throw new Error("denied");
          },
          setItem: () => {
            throw new Error("quota");
          },
          removeItem: () => {
            throw new Error("denied");
          },
        }) as unknown as Storage,
    );
    expect(full.get("a")).toBeNull();
    expect(() => full.set("a", "1")).not.toThrow();
    expect(() => full.remove("a")).not.toThrow();
  });

  it("works when there is no storage at all", () => {
    const none = createSafeStorage(() => undefined);
    expect(none.get("a")).toBeNull();
    expect(() => none.set("a", "1")).not.toThrow();
  });
});
