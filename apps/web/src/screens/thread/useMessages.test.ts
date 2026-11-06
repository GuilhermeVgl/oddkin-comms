// @vitest-environment happy-dom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({
  client: {},
  clearUnread: vi.fn(),
  listMessages: vi.fn(async () => []),
  setReadCursor: vi.fn(async () => undefined),
  decryptMessages: vi.fn(async (_crypto, messages) => messages),
}));

vi.mock("@crewstead/api-client", () => ({
  listMessages: spies.listMessages,
  setReadCursor: spies.setReadCursor,
}));
vi.mock("../../e2ee/content", () => ({
  decryptMessages: spies.decryptMessages,
}));
vi.mock("../../events", () => ({ useEvents: vi.fn() }));
vi.mock("../../inbox", () => ({
  useInbox: () => ({ clearUnread: spies.clearUnread }),
}));
vi.mock("../../workspace", () => ({
  useWorkspace: () => ({ client: spies.client }),
}));

import { useMessages } from "./useMessages";

describe("useMessages", () => {
  beforeEach(() => {
    spies.listMessages.mockClear();
    spies.setReadCursor.mockClear();
    spies.decryptMessages.mockClear();
  });

  it("waits for the DM key instead of rendering encrypted placeholders", async () => {
    const { rerender } = renderHook(
      ({ ready }) => useMessages("dm-1", null, "dm", ready),
      { initialProps: { ready: false } },
    );

    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(spies.listMessages).not.toHaveBeenCalled();

    rerender({ ready: true });
    await waitFor(() => expect(spies.listMessages).toHaveBeenCalledTimes(1));
  });

  it("loads a conversation only once when it opens", async () => {
    renderHook(() => useMessages("chat-1", null, "chat", true));
    await waitFor(() => expect(spies.listMessages).toHaveBeenCalledTimes(1));
  });
});
