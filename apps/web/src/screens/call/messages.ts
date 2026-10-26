import { ApiStatusError, CallConflictError } from "@crewstead/api-client";

const CONFLICT_MESSAGE: Record<string, string> = {
  call_full: "Esta chamada já tem 5 participantes.",
  in_other_call: "Você já está em outra chamada. Saia dela antes de entrar.",
  other_device: "Você já está nesta chamada em outro dispositivo.",
  call_ended: "Esta chamada já terminou.",
  screen_share_taken: "Outra pessoa já está compartilhando a tela.",
  not_in_call: "Entre na chamada antes de compartilhar a tela.",
};

/** What to tell the person when a call request fails. */
export function describeCallError(error: unknown): string {
  if (error instanceof CallConflictError && error.code !== null) {
    return CONFLICT_MESSAGE[error.code] ?? "Não foi possível concluir.";
  }
  if (error instanceof ApiStatusError) {
    if (error.status === 403) return "Seu perfil não permite esta ação.";
    if (error.status === 503)
      return "O servidor de chamadas não está disponível.";
  }
  return "Não foi possível concluir a ação.";
}

/** Browsers say "denied" when the person cancels the picker; that is not an error to show. */
export function describeShareError(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError")
    return "";
  if (error instanceof Error && error.message === "monitor_only")
    return "Escolha uma tela inteira: janelas e abas não podem ser compartilhadas.";
  if (error instanceof Error && error.message === "screen_permission_timeout")
    return "Não foi possível liberar o compartilhamento agora. Tente de novo.";
  return describeCallError(error);
}

/** Why joining failed, from the codes the join steps throw. */
export function describeJoinError(error: unknown): string {
  if (error instanceof Error && error.message === "unlock_required")
    return "Libere a criptografia deste navegador antes de entrar.";
  if (error instanceof Error && error.message === "e2ee_unavailable")
    return "Este navegador não suporta criptografia de mídia obrigatória.";
  return describeCallError(error);
}

/** Joining from another device is offered as a transfer instead of an error. */
export function isOtherDeviceConflict(error: unknown): boolean {
  return error instanceof CallConflictError && error.code === "other_device";
}
