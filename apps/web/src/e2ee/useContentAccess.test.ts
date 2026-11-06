// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "./useSession";

const spies = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("./projectCrypto", () => ({
  ContentCrypto: class {
    refresh = spies.refresh;
  },
}));
vi.mock("./callCrypto", () => ({ CallCrypto: class {} }));

import { useContentAccess } from "./useContentAccess";

function session(): Session {
  return {
    client: {} as Session["client"],
    account: { id: "a1" } as Session["account"],
    runtime: { current: null },
    record: { current: { deviceId: "d1" } as never },
    keyring: { current: {} as never },
    scopes: { current: new Map() },
    runtimeOf: async () => ({ crypto: {}, vault: { unlocked: true } }) as never,
    buildKeyring: async () => undefined,
  };
}

describe("useContentAccess", () => {
  beforeEach(() => spies.refresh.mockReset());

  it("reuses an opened scope without reloading keys on content-only updates", async () => {
    const { result } = renderHook(() => useContentAccess(session()));

    await result.current.openProject("p1", { refresh: false });
    await result.current.openProject("p1", { refresh: false });

    expect(spies.refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes an existing scope after a key-domain update", async () => {
    const { result } = renderHook(() => useContentAccess(session()));

    await result.current.openProject("p1", { refresh: false });
    await result.current.openProject("p1", { refresh: true });

    expect(spies.refresh).toHaveBeenCalledTimes(2);
  });
});
