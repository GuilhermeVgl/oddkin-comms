// @vitest-environment happy-dom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Home } from "../Home";
import { renderApp } from "../../testing/AppHarness";
import { ME, defaultWorld } from "../../testing/fakeApi";

afterEach(() => vi.unstubAllGlobals());

describe("Home", () => {
  it("lists the person's open work and leaves finished work out", async () => {
    const { api } = await renderApp(<Home account={ME} />);
    await waitFor(() =>
      expect(screen.getAllByText("Revisar contratos").length).toBeGreaterThan(
        0,
      ),
    );
    expect(screen.getAllByText("Escrever o plano").length).toBeGreaterThan(0);
    expect(screen.getByText(/2 itens na fila/)).toBeTruthy();
    expect(api.unhandled).toEqual([]);
  });

  it("says the queue is clear when nothing is assigned", async () => {
    const world = defaultWorld();
    world.items = [];
    await renderApp(<Home account={ME} />, { world });
    await waitFor(() =>
      expect(screen.getByText(/Sua fila está limpa/)).toBeTruthy(),
    );
  });

  it("offers a new activity once there is a project", async () => {
    const { shell } = await renderApp(<Home account={ME} />);
    await waitFor(() => screen.getByRole("button", { name: /Nova atividade/ }));
    fireEvent.click(screen.getByRole("button", { name: /Nova atividade/ }));
    expect(shell.openNewItem).toHaveBeenCalled();
  });

  it("shows the mission of the active sprint with how much is done", async () => {
    const world = defaultWorld();
    world.sprints = [
      {
        id: "s1",
        name: "Sprint 1",
        goal: "Entregar o login",
        startsOn: "2026-10-20",
        endsOn: "2026-11-03",
        state: "active",
        version: 1,
        encrypted: false,
        contentRevision: 0,
      },
    ];
    world.items = world.items.map((item) => ({ ...item, sprintId: "s1" }));
    await renderApp(<Home account={ME} />, { world });
    await waitFor(() =>
      expect(screen.getByText(/Entregar o login/)).toBeTruthy(),
    );
    expect(screen.getByText("Sprint 1")).toBeTruthy();
  });
});
