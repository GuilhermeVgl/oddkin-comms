// @vitest-environment happy-dom
import type { CallInvitation } from "@crewstead/api-client";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IncomingCalls } from "./IncomingCalls";

const fresh = (overrides: Partial<CallInvitation> = {}): CallInvitation => ({
  callId: "c1",
  conversationId: "k1",
  startedBy: "ana@crewstead.test",
  createdAt: new Date().toISOString(),
  ...overrides,
});

function show(invitations: CallInvitation[], busy = false) {
  const onAnswer = vi.fn();
  const onDecline = vi.fn();
  render(
    <IncomingCalls
      busy={busy}
      invitations={invitations}
      onAnswer={onAnswer}
      onDecline={onDecline}
      where={(id) => (id === "k1" ? "#geral" : "conversa direta")}
    />,
  );
  return { onAnswer, onDecline };
}

describe("IncomingCalls", () => {
  it("shows who is calling and where", () => {
    show([fresh()]);
    expect(screen.getByText("Ana")).toBeTruthy();
    expect(screen.getByText(/está ligando · #geral/)).toBeTruthy();
  });

  it("answers and declines the right call", () => {
    const { onAnswer, onDecline } = show([fresh({ callId: "c9" })]);
    fireEvent.click(screen.getByRole("button", { name: /Atender/ }));
    expect(onAnswer).toHaveBeenCalledWith("c9");
    fireEvent.click(screen.getByRole("button", { name: /Recusar/ }));
    expect(onDecline).toHaveBeenCalledWith("c9");
  });

  it("does not let someone already in a call answer another one", () => {
    show([fresh()], true);
    expect(
      (screen.getByRole("button", { name: /Atender/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("shows nothing for a call that stopped ringing", () => {
    show([fresh({ createdAt: new Date(Date.now() - 120_000).toISOString() })]);
    expect(screen.queryByText("Ana")).toBeNull();
  });

  it("stacks every caller", () => {
    show([fresh(), fresh({ callId: "c2", startedBy: "bruno@crewstead.test" })]);
    expect(screen.getAllByRole("button", { name: /Atender/ })).toHaveLength(2);
  });
});
