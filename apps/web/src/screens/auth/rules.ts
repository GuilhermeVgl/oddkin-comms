import type { LoginResult } from "@crewstead/api-client";

export const MIN_PASSWORD = 12;

export type Notice = { kind: "err" | "warn"; text: string };

/** What the sign-in form says after the server refused. */
export function loginFailure(
  result: Exclude<LoginResult, "authenticated">,
): Notice {
  if (result === "rate-limited")
    return {
      kind: "warn",
      text: "Muitas tentativas. Aguarde um instante antes de tentar de novo.",
    };
  if (result === "unavailable")
    return {
      kind: "warn",
      text: "O serviço está temporariamente indisponível.",
    };
  return {
    kind: "err",
    text: "E-mail ou senha incorretos. Confira os dados e tente de novo.",
  };
}

/** The toast after asking for a reset link. The answer is the same for any address. */
export function resetRequestOutcome(
  result: "accepted" | "rate-limited" | "unavailable",
): { message: string; failed: boolean } {
  if (result === "accepted")
    return {
      message: "Se existir uma conta, o link foi enviado.",
      failed: false,
    };
  return {
    message:
      result === "rate-limited"
        ? "Muitas tentativas. Aguarde um instante."
        : "O envio de e-mails não está disponível agora.",
    failed: true,
  };
}

/** Why a reset link could not be used. */
export function resetConfirmFailure(
  result: "invalid" | "weak" | "rate-limited",
): string {
  if (result === "weak") return `Use pelo menos ${MIN_PASSWORD} caracteres.`;
  if (result === "rate-limited")
    return "Muitas tentativas. Aguarde um instante.";
  return "Este link é inválido, já foi usado ou expirou. Peça um novo.";
}

/** Empty when the two passwords agree. */
export function passwordsMismatch(password: string, again: string): string {
  return password === again ? "" : "As senhas não são iguais.";
}

const INVITE_TOKEN_LENGTH = 43;

/**
 * The e-mail link carries both values, so a pasted link works as well as the
 * bare code. Null when the code or the e-mail cannot be an invitation.
 */
export function parseInviteForm(
  code: string,
  email: string,
): { email: string; token: string } | null {
  const pasted = /[?&]token=([A-Za-z0-9_-]{43})/.exec(code);
  const token = pasted?.[1] ?? code.trim();
  if (
    token.length !== INVITE_TOKEN_LENGTH ||
    !/^\S+@\S+\.\S+$/.test(email.trim())
  ) {
    return null;
  }
  return { email: email.trim(), token };
}

/** Why the server did not accept an invitation. */
export function invitationRejection(result: "invalid" | "unavailable"): string {
  return result === "invalid"
    ? "O convite não é válido, já foi usado ou pertence a outra conta. Se você já tem conta com este e-mail, use “Já tenho uma conta” para entrar e aceitar."
    : "O serviço está temporariamente indisponível.";
}

/** A signed-in person may only accept an invitation addressed to them. */
export function accountMatchesInvitation(
  account: { email: string } | undefined,
  invitation: { email: string },
): boolean {
  return (
    account === undefined ||
    account.email.toLowerCase() === invitation.email.toLowerCase()
  );
}

/** Four by four grid derived from a fingerprint: a quick visual check, never a substitute for the text. */
export function fingerprintCells(seed: string): number[] {
  let hash = 0;
  for (const character of seed)
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const cells: number[] = [];
  for (let index = 0; index < 16; index++) {
    hash = (hash * 1103515245 + 12345) >>> 0;
    cells.push((hash >> 16) & 1);
  }
  return cells;
}

export const LOGIN_LINES = [
  "Pequenos passos. Grandes entregas.",
  "Criar. Testar. Repetir.",
  "Bem-vinda(o) de volta.",
];

/** The mascot's pose while each line of the sign-in dialogue is on screen. */
export function poseForLine(index: number): "idle" | "think" | "wave" {
  return index === 1 ? "think" : index === 2 ? "wave" : "idle";
}
