// @vitest-environment happy-dom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderApp } from "../testing/AppHarness";
import { ME } from "../testing/fakeApi";
import { Chat } from "./Chat";

afterEach(() => vi.restoreAllMocks());

it("opens the native file picker directly from the composer clip", async () => {
  const click = vi
    .spyOn(HTMLInputElement.prototype, "click")
    .mockImplementation(() => undefined);
  await renderApp(<Chat account={ME} conversationId="k1" />);
  await waitFor(() => screen.getByRole("button", { name: "Anexar arquivo" }));
  expect(screen.queryByRole("button", { name: "Arquivos" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Anexar arquivo" }));
  expect(click).toHaveBeenCalledOnce();
});
