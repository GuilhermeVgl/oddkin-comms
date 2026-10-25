import {
  ApiStatusError,
  EncryptionError,
  readCookie,
} from "@oddkin/api-client";
import { EncryptionUnavailableError } from "./e2ee/content";

/** The CSRF token the API expects on every mutation; throws when the session cookie is gone. */
export function csrfToken(): string {
  const token = readCookie(document.cookie, "oddkin_csrf");
  if (token === null) throw new Error("missing csrf cookie");
  return token;
}

/** A short, human message for a failed action. Never includes server internals. */
export function describeError(error: unknown): string {
  if (error instanceof EncryptionUnavailableError) {
    return "Este conteúdo é cifrado. Libere a criptografia deste navegador para escrever.";
  }
  if (error instanceof EncryptionError) {
    if (error.code === "rotation_required")
      return "A chave está sendo renovada. Tente de novo em instantes.";
    if (error.code === "stale_generation")
      return "A chave mudou. Recarregamos; tente de novo.";
    if (error.code === "encryption_required")
      return "Este conteúdo exige criptografia. Libere este navegador.";
  }
  if (error instanceof ApiStatusError) {
    if (error.status === 409)
      return "Outra alteração chegou primeiro ou o estado mudou. Recarregamos os dados.";
    if (error.status === 403) return "Seu perfil não permite isso.";
    if (error.status === 404) return "Não encontrado ou sem acesso.";
    if (error.status === 429) return "Muitas tentativas. Aguarde um instante.";
  }
  return "Não foi possível concluir a ação.";
}
