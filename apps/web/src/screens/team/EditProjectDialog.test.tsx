// @vitest-environment happy-dom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ConfirmHost } from "../../design/confirm";
import { renderApp } from "../../testing/AppHarness";
import { defaultWorld } from "../../testing/fakeApi";
import { EditProjectDialog } from "./EditProjectDialog";

it("permanently deletes a project only after explicit confirmation", async () => {
  const world = defaultWorld();
  const onClose = vi.fn();
  const { api } = await renderApp(
    <>
      <EditProjectDialog
        canDelete
        onClose={onClose}
        state={{
          project: world.projects[0]!,
          columns: world.columns["p1"]!,
          items: world.items,
          epics: world.epics,
          members: world.members["p1"]!,
          crypto: null,
          status: new Map(),
          keyed: false,
          canRead: true,
        }}
      />
      <ConfirmHost />
    </>,
    { world },
  );

  fireEvent.click(screen.getByRole("button", { name: "Excluir projeto" }));
  expect(onClose).toHaveBeenCalledOnce();
  fireEvent.click(
    await screen.findByRole("button", { name: "Excluir permanentemente" }),
  );

  await waitFor(() => expect(api.world.projects).toHaveLength(0));
  expect(api.world.items).toHaveLength(0);
  expect(api.count("DELETE", /\/api\/v1\/projects\/p1$/)).toBe(1);
});
