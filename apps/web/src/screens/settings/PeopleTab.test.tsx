// @vitest-environment happy-dom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "../../testing/AppHarness";
import { ME, defaultWorld } from "../../testing/fakeApi";
import { PeopleTab } from "./PeopleTab";

afterEach(() => vi.unstubAllGlobals());

describe("organization people projects", () => {
  it("changes project membership and manager role from the person", async () => {
    const world = defaultWorld();
    world.members.p1 =
      world.members.p1?.filter((member) => member.accountId !== "acc-bruno") ??
      [];
    const { api } = await renderApp(<PeopleTab account={ME} />, { world });

    const projects = await screen.findByRole("button", { name: /Projetos 0/ });
    fireEvent.click(projects);
    const list = await screen.findByRole("list", { name: "Projetos de Bruno" });
    fireEvent.click(within(list).getByRole("button", { name: "Adicionar" }));

    await waitFor(() =>
      expect(
        api.world.members.p1?.some(
          (member) => member.accountId === "acc-bruno",
        ),
      ).toBe(true),
    );
    fireEvent.click(
      await within(list).findByRole("button", { name: "Tornar gestor" }),
    );
    await waitFor(() =>
      expect(
        api.world.members.p1?.find((member) => member.accountId === "acc-bruno")
          ?.isManager,
      ).toBe(true),
    );
    expect(api.count("POST", /projects\/p1\/members$/)).toBe(1);
    expect(api.count("PUT", /projects\/p1\/members\/acc-bruno$/)).toBe(1);
  });

  it("explains that an external person cannot become a manager", async () => {
    const world = defaultWorld();
    world.people[1] = {
      ...world.people[1]!,
      membershipKind: "external",
    };
    world.members.p1![1] = {
      ...world.members.p1![1]!,
      membershipKind: "external",
    };
    await renderApp(<PeopleTab account={ME} />, { world });

    const bruno = (await screen.findByText("Bruno")).closest("li");
    expect(bruno).not.toBeNull();
    fireEvent.click(within(bruno!).getByRole("button", { name: /Projetos 1/ }));
    expect(screen.getByText(/não podem ser gestoras/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Tornar gestor" })).toBeNull();
  });
});
