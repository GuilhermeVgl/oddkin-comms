// @vitest-environment happy-dom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "../testing/AppHarness";
import { ME, defaultWorld, type World } from "../testing/fakeApi";
import { Sprints } from "./Sprints";

beforeEach(() => {
  window.location.hash = "#/sprints";
  window.localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

const sprint = (overrides: Partial<World["sprints"][number]> = {}) => ({
  id: "s1",
  name: "Sprint 1",
  goal: "Entregar o login",
  startsOn: "2026-10-20",
  endsOn: "2026-11-03",
  state: "planned" as const,
  version: 1,
  encrypted: false,
  contentRevision: 0,
  ...overrides,
});

describe("Sprints", () => {
  it("says there is no active sprint and lists the backlog", async () => {
    await renderApp(<Sprints account={ME} />);
    await screen.findByText("Nenhuma sprint ativa");
    expect(screen.getByText("Revisar contratos")).toBeTruthy();
  });

  it("creates a sprint from the dialog", async () => {
    const { api } = await renderApp(<Sprints account={ME} />);
    fireEvent.click(await screen.findByRole("button", { name: /Nova sprint/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Nome"), {
      target: { value: "Sprint Alfa" },
    });
    fireEvent.submit(within(dialog).getByLabelText("Nome").closest("form")!);
    await waitFor(() => expect(api.world.sprints[0]?.name).toBe("Sprint Alfa"));
  });

  it("refuses dates in the wrong order", async () => {
    const { api } = await renderApp(<Sprints account={ME} />);
    fireEvent.click(await screen.findByRole("button", { name: /Nova sprint/ }));
    const dialog = await screen.findByRole("dialog");
    const dates =
      dialog.querySelectorAll<HTMLInputElement>('input[type="date"]');
    fireEvent.change(dates[0]!, { target: { value: "2026-12-01" } });
    fireEvent.change(dates[1]!, { target: { value: "2026-11-01" } });
    fireEvent.submit(within(dialog).getByLabelText("Nome").closest("form")!);
    expect(await within(dialog).findByRole("alert")).toBeTruthy();
    expect(api.world.sprints).toHaveLength(0);
  });

  it("starts a planned sprint", async () => {
    const world = defaultWorld();
    world.sprints = [sprint()];
    const { api } = await renderApp(<Sprints account={ME} />, { world });
    fireEvent.click(await screen.findByRole("button", { name: /Iniciar/ }));
    await waitFor(() => expect(api.world.sprints[0]?.state).toBe("active"));
  });

  it("shows the active sprint with its mission and progress", async () => {
    const world = defaultWorld();
    world.sprints = [sprint({ state: "active" })];
    world.items = world.items.map((item) => ({ ...item, sprintId: "s1" }));
    await renderApp(<Sprints account={ME} />, { world });
    await screen.findByText("Missão: Entregar o login");
    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Encerrar sprint/ }),
    ).toBeTruthy();
  });

  it("closes a sprint through the wizard, carrying pending work to the next one", async () => {
    const world = defaultWorld();
    world.sprints = [
      sprint({ state: "active" }),
      sprint({ id: "s2", name: "Sprint 2", state: "planned" }),
    ];
    world.items = world.items.map((item) => ({ ...item, sprintId: "s1" }));
    const { api } = await renderApp(<Sprints account={ME} />, { world });
    fireEvent.click(
      await screen.findByRole("button", { name: /Encerrar sprint/ }),
    );
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(/Resumo/);
    for (const label of [
      /Continuar|Próximo|Avançar/,
      /Continuar|Próximo|Avançar/,
    ]) {
      fireEvent.click(
        await within(dialog).findByRole("button", { name: label }),
      );
    }
    fireEvent.click(
      await within(dialog).findByRole("button", { name: /Encerrar sprint/ }),
    );
    await waitFor(() => expect(api.world.sprints[0]?.state).toBe("closed"));
  });

  it("hides planning from people who are not administrators", async () => {
    const world = defaultWorld();
    world.account = { ...ME, isAdmin: false };
    await renderApp(<Sprints account={world.account} />, { world });
    await screen.findByText("Nenhuma sprint ativa");
    expect(screen.queryByRole("button", { name: /Nova sprint/ })).toBeNull();
  });
});
