// @vitest-environment happy-dom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderApp } from "../testing/AppHarness";
import { defaultWorld, ME } from "../testing/fakeApi";
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

it("does not upload dropped files when the project forbids attachments", async () => {
  const world = defaultWorld();
  const project = world.projects[0];
  if (project === undefined) throw new Error("missing test project");
  project.permissions = project.permissions?.filter(
    (permission) => permission !== "files.upload",
  );
  const { api } = await renderApp(<Chat account={ME} conversationId="k1" />, {
    world,
  });
  await waitFor(() => screen.getByRole("form", { name: "Escrever mensagem" }));
  expect(screen.queryByRole("button", { name: "Anexar arquivo" })).toBeNull();
  fireEvent.drop(screen.getByRole("form", { name: "Escrever mensagem" }), {
    dataTransfer: {
      files: [new File(["image"], "photo.png", { type: "image/png" })],
    },
  });
  expect(api.calls.some((call) => call.path === "/api/v1/uploads")).toBe(false);
});
