import { ApiStatusError, CallConflictError } from "@crewstead/api-client";
import { EncryptionUnavailableError } from "../../e2ee/content";

export const ENCRYPTED_THREAD =
  "Esta conversa é cifrada. Libere a criptografia deste navegador.";

function statusOf(error: unknown): number | null {
  return error instanceof ApiStatusError ? error.status : null;
}

function needsEncryption(error: unknown): boolean {
  return error instanceof EncryptionUnavailableError || statusOf(error) === 409;
}

/** What to tell the person when a reaction, edit or deletion fails. */
export function actFailureMessage(error: unknown): string {
  if (needsEncryption(error)) return ENCRYPTED_THREAD;
  if (statusOf(error) === 403) return "Seu perfil não permite isso.";
  return "Não foi possível concluir. Tente novamente.";
}

/** A failed send stays on screen with a retry, so only encryption needs a toast. */
export function sendFailureMessage(error: unknown): string | null {
  return needsEncryption(error) ? ENCRYPTED_THREAD : null;
}

export function callFailureMessage(error: unknown): string {
  if (error instanceof CallConflictError)
    return "Já existe uma chamada em andamento ou você está em outra.";
  if (statusOf(error) === 503)
    return "O servidor de chamadas não está disponível.";
  return "Não foi possível iniciar a chamada.";
}
