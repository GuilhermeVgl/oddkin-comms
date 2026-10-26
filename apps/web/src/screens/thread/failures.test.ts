import { ApiStatusError, CallConflictError } from "@crewstead/api-client";
import { describe, expect, it } from "vitest";
import { EncryptionUnavailableError } from "../../e2ee/content";
import {
  ENCRYPTED_THREAD,
  actFailureMessage,
  callFailureMessage,
  sendFailureMessage,
} from "./failures";

describe("failures shown in a conversation", () => {
  it("tells the person to unlock encryption", () => {
    expect(actFailureMessage(new EncryptionUnavailableError())).toBe(
      ENCRYPTED_THREAD,
    );
    expect(actFailureMessage(new ApiStatusError(409, "x"))).toBe(
      ENCRYPTED_THREAD,
    );
  });

  it("explains a refusal by the profile", () => {
    expect(actFailureMessage(new ApiStatusError(403, "x"))).toBe(
      "Seu perfil não permite isso.",
    );
  });

  it("falls back to a generic message", () => {
    expect(actFailureMessage(new Error("boom"))).toBe(
      "Não foi possível concluir. Tente novamente.",
    );
  });

  it("only reports encryption problems when a send fails", () => {
    expect(sendFailureMessage(new EncryptionUnavailableError())).toBe(
      ENCRYPTED_THREAD,
    );
    expect(sendFailureMessage(new ApiStatusError(409, "x"))).toBe(
      ENCRYPTED_THREAD,
    );
    expect(sendFailureMessage(new ApiStatusError(500, "x"))).toBeNull();
  });

  it("distinguishes why a call could not start", () => {
    expect(callFailureMessage(new CallConflictError(null))).toBe(
      "Já existe uma chamada em andamento ou você está em outra.",
    );
    expect(callFailureMessage(new ApiStatusError(503, "x"))).toBe(
      "O servidor de chamadas não está disponível.",
    );
    expect(callFailureMessage(new Error("x"))).toBe(
      "Não foi possível iniciar a chamada.",
    );
  });
});
