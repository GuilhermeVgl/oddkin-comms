// @vitest-environment happy-dom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "../testing/AppHarness";
import { ME, defaultWorld } from "../testing/fakeApi";
import { Work } from "./Work";

beforeEach(() => {
  window.location.hash = "#/work";
  window.localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

const board = () => screen.getByRole("list", { name: "Quadro de atividades" });

describe("Work board", () => {
  it("shows one column per board column with its cards", async () => {
    await renderApp(<Work account={ME} itemId={null} />);
    await waitFor(() => screen.getByText("Revisar contratos"));
    const columns = within(board()).getAllByRole("listitem");
    expect(columns).toHaveLength(3);
    expect(within(columns[0]!).getByText("Revisar contratos")).toBeTruthy();
    expect(within(columns[1]!).getByText("Escrever o plano")).toBeTruthy();
    expect(within(columns[2]!).getByText("Publicar o site")).toBeTruthy();
  });

  it("moves a card to the done column with the round check", async () => {
    const { api } = await renderApp(<Work account={ME} itemId={null} />);
    await waitFor(() => screen.getByText("Revisar contratos"));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Concluir Revisar contratos" }),
    );
    await waitFor(() => expect(api.count("PATCH", /work-items\/w1/)).toBe(1));
    expect(api.world.items.find((item) => item.id === "w1")?.columnId).toBe(
      "c-done",
    );
  });

  it("creates a card from the inline field of a column", async () => {
    const { api } = await renderApp(<Work account={ME} itemId={null} />);
    await waitFor(() => screen.getByText("Revisar contratos"));
    fireEvent.click(
      screen.getAllByRole("button", { name: /Adicionar atividade/ })[0]!,
    );
    const input = await screen.findByPlaceholderText(/Título da atividade/);
    fireEvent.change(input, { target: { value: "Nova ideia" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(api.count("POST", /work-items$/)).toBe(1));
    expect(api.world.items.some((item) => item.title === "Nova ideia")).toBe(
      true,
    );
  });

  it("switches to the list and opens a row", async () => {
    await renderApp(<Work account={ME} itemId={null} />);
    await waitFor(() => screen.getByText("Revisar contratos"));
    fireEvent.click(screen.getByRole("button", { name: /Lista/ }));
    const row = await screen.findByText("Escrever o plano");
    fireEvent.click(row);
    await waitFor(() => expect(window.location.hash).toBe("#/work/w2"));
  });

  it("invites the first project when there is none", async () => {
    const world = defaultWorld();
    world.projects = [];
    await renderApp(<Work account={ME} itemId={null} />, { world });
    await waitFor(() => screen.getByText("O mapa está livre"));
    fireEvent.click(screen.getByRole("button", { name: /Novo projeto/ }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("tells a member without projects that nothing is shared yet", async () => {
    const world = defaultWorld();
    world.projects = [];
    world.account = { ...ME, isAdmin: false };
    await renderApp(<Work account={world.account} itemId={null} />, { world });
    await waitFor(() =>
      screen.getByText("Você ainda não participa de nenhum projeto."),
    );
  });

  it("explains when the profile cannot see the activities", async () => {
    const world = defaultWorld();
    const api = (await import("../testing/fakeApi")).createFakeApi(world);
    api.route(
      "GET",
      /\/projects\/p1\/work-items$/,
      () => new Response(null, { status: 403 }),
    );
    await renderApp(<Work account={ME} itemId={null} />, { api });
    await waitFor(() => screen.getByText(/não permite ver as atividades/));
  });
});
