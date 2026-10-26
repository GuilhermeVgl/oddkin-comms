import { act, render, type RenderResult } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { InboxProvider } from "../inbox";
import { CallsProvider } from "../shell/calls";
import { ShellContext, type ShellApi } from "../shell/context";
import { StatsProvider } from "../shell/stats";
import { WorkspaceProvider } from "../workspace";
import { createFakeApi, type FakeApi, type World } from "./fakeApi";

/** What a screen needs around it: the workspace, inbox, calls and scoreboard over a fake backend. */
export async function renderApp(
  ui: ReactNode,
  options: { api?: FakeApi; world?: World; shell?: Partial<ShellApi> } = {},
): Promise<RenderResult & { api: FakeApi; shell: ShellApi }> {
  const api = options.api ?? createFakeApi(options.world);
  vi.stubGlobal("fetch", api.fetch);
  const shell: ShellApi = {
    openPalette: vi.fn(),
    openNewItem: vi.fn(),
    openGate: vi.fn(),
    offline: false,
    ...options.shell,
  };
  let result!: RenderResult;
  await act(async () => {
    result = render(
      <WorkspaceProvider account={api.world.account}>
        <InboxProvider>
          <CallsProvider>
            <StatsProvider accountId={api.world.account.id}>
              <ShellContext.Provider value={shell}>{ui}</ShellContext.Provider>
            </StatsProvider>
          </CallsProvider>
        </InboxProvider>
      </WorkspaceProvider>,
    );
  });
  // Let the first round of requests settle.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return Object.assign(result, { api, shell });
}
