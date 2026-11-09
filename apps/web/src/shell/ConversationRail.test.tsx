// @vitest-environment happy-dom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { renderApp } from "../testing/AppHarness";
import { ConversationRail } from "./ConversationRail";

it("keeps project channels visible outside the messages screen", async () => {
  window.location.hash = "#/work";
  const onToggle = vi.fn();
  await renderApp(<ConversationRail collapsed={false} onToggle={onToggle} />);
  await waitFor(() => screen.getByRole("button", { name: /^geral$/i }));
  expect(
    screen.getByRole("complementary", { name: "Conversas e chamadas" }),
  ).toBeTruthy();
  expect(screen.getByText("Mensagens diretas")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Recolher conversas" }));
  expect(onToggle).toHaveBeenCalledOnce();
});
