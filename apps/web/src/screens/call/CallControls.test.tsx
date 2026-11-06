// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CallControls } from "./CallControls";
import { CallError } from "./CallError";

function controls(overrides: Partial<Parameters<typeof CallControls>[0]> = {}) {
  const handlers = {
    onToggleMicrophone: vi.fn(),
    onToggleCamera: vi.fn(),
    onMicrophoneChange: vi.fn(),
    onCameraChange: vi.fn(),
    onResumeAudio: vi.fn(),
    onToggleChat: vi.fn(),
    onToggleShareFocus: vi.fn(),
    onToggleScreen: vi.fn(),
    onSwitchScreen: vi.fn(),
    onLeave: vi.fn(),
  };
  render(
    <CallControls
      canEnd={false}
      audioBlocked={false}
      cameraId="cam-1"
      cameras={
        [
          { deviceId: "cam-1", kind: "videoinput", label: "Câmera frontal" },
        ] as MediaDeviceInfo[]
      }
      cameraOn={false}
      deviceBusy={false}
      microphoneId="mic-1"
      microphones={
        [
          { deviceId: "mic-1", kind: "audioinput", label: "Microfone USB" },
        ] as MediaDeviceInfo[]
      }
      muted={false}
      chatAvailable
      chatOpen={false}
      shareFocus="screen"
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

  it("leaves screen audio to the browser share picker", () => {
    controls();
    expect(screen.queryByRole("button", { name: /som/i })).toBeNull();
  });

  it("changes microphone and camera while connected", () => {
    const handlers = controls();
    fireEvent.click(
      screen.getByRole("button", { name: "Escolher microfone e câmera" }),
    );
    fireEvent.change(screen.getByLabelText("Microfone da chamada"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Câmera da chamada"), {
      target: { value: "" },
    });
    expect(handlers.onMicrophoneChange).toHaveBeenCalledWith("");
    expect(handlers.onCameraChange).toHaveBeenCalledWith("");
  });

  it("opens and closes the contextual call chat", () => {
    const handlers = controls({ chatOpen: false });
    fireEvent.click(screen.getByRole("button", { name: "Mostrar chat" }));
    expect(handlers.onToggleChat).toHaveBeenCalled();
  });

  it("lets the presenter swap the shared screen and people", () => {
    const handlers = controls({ sharing: true, shareFocus: "screen" });
    fireEvent.click(
      screen.getByRole("button", { name: "Destacar pessoas" }),
    );
    expect(handlers.onToggleShareFocus).toHaveBeenCalled();
  });

  it("offers an explicit audio unlock when autoplay was blocked", () => {
    const handlers = controls({ audioBlocked: true });
    fireEvent.click(screen.getByRole("button", { name: "Ativar áudio" }));
    expect(handlers.onResumeAudio).toHaveBeenCalled();
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
