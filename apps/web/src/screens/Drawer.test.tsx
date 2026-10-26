// @vitest-environment happy-dom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "../testing/AppHarness";
import { ME, createFakeApi, defaultWorld } from "../testing/fakeApi";
import { Work } from "./Work";

beforeEach(() => {
  window.location.hash = "#/work/w1";
  window.localStorage.clear();
  // The dialog may call showModal/close, which happy-dom provides.
});
afterEach(() => vi.unstubAllGlobals());

async function open(itemId = "w1", api = createFakeApi()) {
  const result = await renderApp(<Work account={ME} itemId={itemId} />, {
    api,
  });
  await screen.findByRole("dialog", { name: /Detalhe da atividade/ });
  return { ...result, api };
}

describe("activity card", () => {
  it("shows the fields of the activity", async () => {
    await open();
    expect((screen.getByLabelText("Título") as HTMLInputElement).value).toBe(
      "Revisar contratos",
    );
    expect((screen.getByLabelText("Estado") as HTMLSelectElement).value).toBe(
      "c-todo",
    );
    expect(
      (screen.getByLabelText("Responsável") as HTMLSelectElement).value,
    ).toBe(ME.id);
    expect((screen.getByLabelText("Prazo") as HTMLInputElement).value).toBe(
      "2026-10-30",
    );
  });

  it("renames the activity when the title field loses focus", async () => {
    const { api } = await open();
    const title = screen.getByLabelText("Título");
    fireEvent.change(title, {
      target: { value: "Revisar os contratos novos" },
    });
    fireEvent.blur(title);
    await waitFor(() => expect(api.count("PATCH", /work-items\/w1/)).toBe(1));
    expect(api.world.items.find((i) => i.id === "w1")?.title).toBe(
      "Revisar os contratos novos",
    );
  });

  it("does not save an emptied title", async () => {
    const { api } = await open();
    const title = screen.getByLabelText("Título");
    fireEvent.change(title, { target: { value: "   " } });
    fireEvent.blur(title);
    expect((title as HTMLInputElement).value).toBe("Revisar contratos");
    expect(api.count("PATCH", /work-items/)).toBe(0);
  });

  it("changes state, priority, due date and assignee from the tiles", async () => {
    const { api } = await open();
    fireEvent.change(screen.getByLabelText("Estado"), {
      target: { value: "c-doing" },
    });
    await waitFor(() => expect(api.world.items[0]?.columnId).toBe("c-doing"));
    fireEvent.change(
      within(screen.getByRole("dialog")).getByLabelText("Prioridade"),
      {
        target: { value: "urgent" },
      },
    );
    await waitFor(() => expect(api.world.items[0]?.priority).toBe("urgent"));
    fireEvent.change(screen.getByLabelText("Prazo"), {
      target: { value: "2026-11-02" },
    });
    await waitFor(() => expect(api.world.items[0]?.dueDate).toBe("2026-11-02"));
    fireEvent.change(screen.getByLabelText("Prazo"), { target: { value: "" } });
    await waitFor(() => expect(api.world.items[0]?.dueDate).toBeUndefined());
    fireEvent.change(screen.getByLabelText("Responsável"), {
      target: { value: "" },
    });
    await waitFor(() => expect(api.world.items[0]?.assigneeId).toBeUndefined());
  });

  it("adds a subtask and a comment", async () => {
    const { api } = await open();
    fireEvent.change(screen.getByLabelText("Nova subtarefa"), {
      target: { value: "Ler a cláusula 4" },
    });
    fireEvent.submit(screen.getByLabelText("Nova subtarefa").closest("form")!);
    await waitFor(() =>
      expect(api.world.items.some((i) => i.kind === "subtask")).toBe(true),
    );
    fireEvent.change(screen.getByLabelText("Novo comentário"), {
      target: { value: "Primeiro!" },
    });
    fireEvent.submit(screen.getByLabelText("Novo comentário").closest("form")!);
    await waitFor(() =>
      expect(api.world.comments["w1"]?.[0]?.body).toBe("Primeiro!"),
    );
    expect(await screen.findByText("Primeiro!")).toBeTruthy();
  });

  it("completes and reopens the activity from the footer", async () => {
    const { api } = await open();
    fireEvent.click(screen.getByRole("button", { name: /Concluir atividade/ }));
    await waitFor(() => expect(api.world.items[0]?.columnId).toBe("c-done"));
    fireEvent.click(await screen.findByRole("button", { name: "Reabrir" }));
    await waitFor(() => expect(api.world.items[0]?.columnId).toBe("c-doing"));
  });

  it("follows and unfollows", async () => {
    const { api } = await open();
    fireEvent.click(screen.getByRole("button", { name: /Seguir/ }));
    await waitFor(() => expect(api.count("PUT", /followers\/me/)).toBe(1));
    fireEvent.click(await screen.findByRole("button", { name: /Seguindo/ }));
    await waitFor(() => expect(api.count("DELETE", /followers\/me/)).toBe(1));
  });

  it("starts a focus block on an open activity", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: /^Foco$/ }));
    await waitFor(() =>
      expect(window.localStorage.getItem("crewstead.focus")).toContain("w1"),
    );
  });

  it("lets someone thank the assignee of finished work", async () => {
    const world = defaultWorld();
    world.items[2] = { ...world.items[2]!, assigneeId: "acc-bruno" };
    const api = createFakeApi(world);
    window.location.hash = "#/work/w3";
    await open("w3", api);
    const thanks = await screen.findByRole("button", { name: /Valeu/ });
    await waitFor(() =>
      expect((thanks as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(thanks);
    await waitFor(() => expect(api.count("PUT", /kudos/)).toBe(1));
  });

  it("explains a conflicting edit and keeps the person's text on request", async () => {
    const api = createFakeApi();
    await open("w1", api);
    api.route(
      "PATCH",
      /work-items\/w1$/,
      () => new Response(null, { status: 409 }),
    );
    const title = screen.getByLabelText("Título");
    fireEvent.change(title, { target: { value: "Outro título" } });
    fireEvent.blur(title);
    await screen.findByText(/Outra pessoa alterou este item/);
    fireEvent.click(
      screen.getByRole("button", { name: /Recarregar e usar a atual/ }),
    );
    await waitFor(() =>
      expect(screen.queryByText(/Outra pessoa alterou/)).toBeNull(),
    );
  });

  it("archives from the more menu", async () => {
    const { api } = await open();
    fireEvent.click(screen.getByRole("button", { name: "Mais ações" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Arquivar/ }));
    await waitFor(() =>
      expect(api.world.items[0]).toMatchObject({ archived: true }),
    );
  });

  it("closes back to the board", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Fechar detalhe" }));
    await waitFor(() => expect(window.location.hash).toBe("#/work"));
  });
});
