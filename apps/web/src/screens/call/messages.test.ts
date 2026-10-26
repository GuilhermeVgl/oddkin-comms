import { ApiStatusError, CallConflictError } from "@crewstead/api-client";
import { describe, expect, it } from "vitest";
import {
  describeCallError,
  describeJoinError,
  describeShareError,
  isOtherDeviceConflict,
} from "./messages";

describe("describeCallError", () => {
  it("explains each conflict the server reports", () => {
    expect(describeCallError(new CallConflictError("call_full"))).toBe(
      "Esta chamada já tem 5 participantes.",
    );
    expect(describeCallError(new CallConflictError("in_other_call"))).toContain(
      "outra chamada",
    );
    expect(describeCallError(new CallConflictError("call_ended"))).toBe(
      "Esta chamada já terminou.",
    );
  });

  it("falls back for a conflict without a known code", () => {
    expect(describeCallError(new CallConflictError(null))).toBe(
      "Não foi possível concluir a ação.",
    );
  });

  it("maps permission and availability statuses", () => {
    expect(describeCallError(new ApiStatusError(403, "x"))).toBe(
      "Seu perfil não permite esta ação.",
    );
    expect(describeCallError(new ApiStatusError(503, "x"))).toBe(
      "O servidor de chamadas não está disponível.",
    );
    expect(describeCallError(new ApiStatusError(500, "x"))).toBe(
      "Não foi possível concluir a ação.",
    );
    expect(describeCallError("boom")).toBe("Não foi possível concluir a ação.");
  });
});

describe("describeShareError", () => {
  it("stays silent when the person cancels the picker", () => {
    expect(
      describeShareError(new DOMException("denied", "NotAllowedError")),
    ).toBe("");
  });

  it("explains the whole-screen rule and the permission timeout", () => {
    expect(describeShareError(new Error("monitor_only"))).toContain(
      "tela inteira",
    );
    expect(
      describeShareError(new Error("screen_permission_timeout")),
    ).toContain("Tente de novo");
  });

  it("uses the general messages for anything else", () => {
    expect(
      describeShareError(new CallConflictError("screen_share_taken")),
    ).toBe("Outra pessoa já está compartilhando a tela.");
  });
});

describe("describeJoinError", () => {
  it("tells apart a locked browser and a browser without media E2EE", () => {
    expect(describeJoinError(new Error("unlock_required"))).toContain("Libere");
    expect(describeJoinError(new Error("e2ee_unavailable"))).toContain(
      "não suporta",
    );
  });

  it("defers to the call messages otherwise", () => {
    expect(describeJoinError(new CallConflictError("other_device"))).toBe(
      "Você já está nesta chamada em outro dispositivo.",
    );
  });
});

describe("isOtherDeviceConflict", () => {
  it("only recognises the other-device conflict", () => {
    expect(isOtherDeviceConflict(new CallConflictError("other_device"))).toBe(
      true,
    );
    expect(isOtherDeviceConflict(new CallConflictError("call_full"))).toBe(
      false,
    );
    expect(isOtherDeviceConflict(new Error("other_device"))).toBe(false);
  });
});
