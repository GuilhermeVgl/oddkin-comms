import type { Call } from "@crewstead/api-client";
import { nameOf } from "../../design/people";

/** The heading of the call: a channel, a person, or a generic name while loading. */
export function callTitle(
  call: Pick<Call, "conversationId"> | null,
  channels: readonly { id: string; name: string }[],
  dms: readonly { id: string; peerEmail: string }[],
): string {
  if (call === null) return "Chamada";
  const channel = channels.find((entry) => entry.id === call.conversationId);
  if (channel !== undefined) return `#${channel.name}`;
  const direct = dms.find((entry) => entry.id === call.conversationId);
  return direct === undefined ? "Conversa direta" : nameOf(direct.peerEmail);
}

/** The presenter goes first so the stage can feature them. */
export function orderParticipants<T>(
  participants: readonly T[],
  sharer: T | undefined,
): T[] {
  return sharer === undefined
    ? [...participants]
    : [sharer, ...participants.filter((participant) => participant !== sharer)];
}

export type StageFocus = "screen" | "people";
export type StageTile<T> = { kind: "camera" | "screen"; participant: T };

/** Keeps camera and screen share as independent tiles so neither disappears. */
export function stageLayout<T>(
  participants: readonly T[],
  sharer: T | undefined,
  focus: StageFocus,
): { main: StageTile<T>[]; rail: StageTile<T>[] } {
  const cameras = participants.map((participant) => ({
    kind: "camera" as const,
    participant,
  }));
  if (sharer === undefined) return { main: cameras, rail: [] };
  const screen = { kind: "screen" as const, participant: sharer };
  return focus === "screen"
    ? { main: [screen], rail: cameras }
    : { main: cameras, rail: [screen] };
}

/** mm:ss for the call timer. */
export function formatClock(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function elapsedSeconds(now: number, since: number): number {
  return Math.max(0, Math.floor((now - since) / 1000));
}

/** The spoken label of a participant tile. */
export function tileLabel(
  name: string,
  state: { muted: boolean; speaking: boolean },
): string {
  return `${nameOf(name)}${state.muted ? ", microfone desligado" : ""}${state.speaking ? ", falando" : ""}`;
}

/** The note shown while the media key changes hands. */
export function rotationNotice(
  call: Pick<Call, "keyState" | "keyGeneration">,
): string {
  const lead =
    call.keyState === "rotation_required"
      ? "Rotacionando chave de mídia"
      : "Aguardando a chave";
  return `${lead}… publicação bloqueada até confirmar a chave v${call.keyGeneration}`;
}

/** How many people are in the room out of how many fit. */
export function participantsCount(count: number, max: number | undefined) {
  return `${count} de ${max ?? 5} participantes`;
}

export function prejoinSubtitle(
  call: Pick<Call, "participants" | "maxParticipants"> | null,
): string {
  return call === null
    ? "Carregando a chamada…"
    : `${call.participants.length}/${call.maxParticipants} participantes agora. Até ${call.maxParticipants} pessoas.`;
}

export function splitDevices<T extends { kind: MediaDeviceKind }>(
  devices: readonly T[],
) {
  return {
    microphones: devices.filter((device) => device.kind === "audioinput"),
    cameras: devices.filter((device) => device.kind === "videoinput"),
  };
}
