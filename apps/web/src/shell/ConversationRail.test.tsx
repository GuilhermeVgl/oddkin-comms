// @vitest-environment happy-dom
import { screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { renderApp } from "../testing/AppHarness";
import { ConversationRail } from "./ConversationRail";

it("keeps project channels visible outside the messages screen", async () => {
  window.location.hash = "#/work";
  await renderApp(<ConversationRail />);
  await waitFor(() => screen.getByRole("button", { name: /^geral$/i }));
  expect(
    screen.getByRole("complementary", { name: "Conversas e chamadas" }),
  ).toBeTruthy();
  expect(screen.getByText("Mensagens diretas")).toBeTruthy();
});
