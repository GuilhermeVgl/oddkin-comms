// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CallControls } from "./CallControls";
import { CallError } from "./CallError";

function controls(overrides: Partial<Parameters<typeof CallControls>[0]> = {}) {
  const handlers = {
    onToggleMicrophone: vi.fn(),
    onToggleCamera: vi.fn(),
    onToggleScreen: vi.fn(),
    onSwitchScreen: vi.fn(),
    onToggleShareAudio: vi.fn(),
    onLeave: vi.fn(),
  };
  render(
    <CallControls
      canEnd={false}
      cameraOn={false}
      muted={false}
      shareAudio={false}
      sharing={false}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe("CallControls", () => {
  it("toggles microphone and camera with labels that follow the state", () => {
    const handlers = controls({ muted: true, cameraOn: true });
    fireEvent.click(screen.getByRole("button", { name: "Ativar microfone" }));
    fireEvent.click(screen.getByRole("button", { name: "Desligar câmera" }));
    expect(handlers.onToggleMicrophone).toHaveBeenCalled();
    expect(handlers.onToggleCamera).toHaveBeenCalled();
  });

  it("leaves the call", () => {
    const handlers = controls();
    fireEvent.click(screen.getByRole("button", { name: /Sair/ }));
    expect(handlers.onLeave).toHaveBeenCalledWith(false);
  });

  it("offers ending for everyone only to who may", () => {
    controls({ canEnd: false });
    expect(screen.queryByRole("button", { name: /Encerrar/ })).toBeNull();
  });
});

describe("CallError", () => {
  it("retries or closes", () => {
    const onRetry = vi.fn();
    const onClose = vi.fn();
    render(
      <CallError message="Sem rede" onClose={onClose} onRetry={onRetry} />,
    );
    expect(screen.getByText("Sem rede")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Tentar entrar/ }));
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(onRetry).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
