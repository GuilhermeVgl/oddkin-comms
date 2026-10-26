import type {
  CurrentAccount,
  ExternalPolicy,
  InvitationStatus,
  InvitePolicy,
  ProjectMember,
} from "@crewstead/api-client";
import type { IconName } from "../../design/icons";

export type Permission = ExternalPolicy["permissions"][number];

export const GROUPS: {
  title: string;
  icon: IconName;
  items: [Permission, string][];
}[] = [
  {
    title: "Atividades",
    icon: "board",
    items: [
      ["work.read", "Ver épicos, atividades e subtarefas"],
      ["work.create", "Criar atividades e subtarefas"],
      ["work.edit", "Editar campos, responsável e prazo"],
      ["work.move", "Mover entre colunas e concluir"],
      ["work.archive", "Arquivar e restaurar"],
      ["work.comment", "Comentar e acompanhar"],
      ["planning.edit", "Gerenciar épicos e vincular a sprints"],
    ],
  },
  {
    title: "Conversas",
    icon: "chat",
    items: [
      ["chat.read", "Ler todos os canais do projeto"],
      ["chat.send", "Enviar, citar, reagir e mencionar"],
      ["direct_messages.use", "Mensagens diretas com o time do projeto"],
    ],
  },
  {
    title: "Arquivos",
    icon: "file",
    items: [
      ["files.download", "Baixar e descriptografar arquivos"],
      ["files.upload", "Enviar arquivos (até 500 MB)"],
    ],
  },
  {
    title: "Chamadas",
    icon: "video",
    items: [
      ["calls.join", "Aceitar convite e participar"],
      ["calls.start", "Iniciar chamada do projeto"],
      ["calls.screen_share", "Compartilhar tela"],
    ],
  },
];

/** A permission that only makes sense together with another one. */
export const DEPENDS: Partial<Record<Permission, Permission>> = {
  "work.create": "work.read",
  "work.edit": "work.read",
  "work.move": "work.read",
  "work.archive": "work.read",
  "work.comment": "work.read",
  "planning.edit": "work.read",
  "chat.send": "chat.read",
  "files.upload": "files.download",
  "calls.start": "calls.join",
  "calls.screen_share": "calls.join",
};

export const LABEL = new Map(GROUPS.flatMap((group) => group.items));

export const SWATCHES = [
  "#63745A",
  "#9C7E3C",
  "#3F5A6B",
  "#8A4F3D",
  "#6B5A8E",
  "#3F7A6E",
  "#7A7A3F",
  "#4A4F4C",
];

export const INVITE_POLICIES: readonly (readonly [InvitePolicy, string])[] = [
  ["admins", "Só a administração"],
  ["managers", "Gestores"],
  ["members", "Todos os membros"],
];

/** The draft without permissions whose requirement is off, repeated until stable. */
export function normalizePermissions(
  draft: readonly Permission[],
): Set<Permission> {
  const kept = new Set(draft);
  let changed = true;
  while (changed) {
    changed = false;
    for (const permission of [...kept]) {
      const need = DEPENDS[permission];
      if (need !== undefined && !kept.has(need)) {
        kept.delete(permission);
        changed = true;
      }
    }
  }
  return kept;
}

/** Switches one permission; turning one off also turns off those that need it. */
export function togglePermission(
  draft: readonly Permission[],
  permission: Permission,
): Permission[] {
  const next = new Set(draft);
  if (next.has(permission)) {
    next.delete(permission);
    for (const [dependent, need] of Object.entries(DEPENDS)) {
      if (need === permission) next.delete(dependent as Permission);
    }
  } else next.add(permission);
  return [...next];
}

/** Whether the draft differs from the saved policy. */
export function policyDirty(
  saved: readonly Permission[] | null,
  normalized: ReadonlySet<Permission>,
): boolean {
  return (
    saved !== null &&
    (saved.length !== normalized.size ||
      saved.some((permission) => !normalized.has(permission)))
  );
}

/**
 * Mirrors what the server decides: administrators always, then managers and
 * members as far as the project's policy goes; externals never.
 */
export function canInviteToProject(
  account: Pick<CurrentAccount, "isAdmin" | "membershipKind">,
  project: { isManager: boolean; policy: InvitePolicy },
): boolean {
  if (account.isAdmin) return true;
  if (account.membershipKind !== "internal") return false;
  return project.isManager
    ? project.policy === "managers" || project.policy === "members"
    : project.policy === "members";
}

export function memberRoleLabel(
  member: Pick<ProjectMember, "isManager" | "membershipKind">,
): string {
  if (member.isManager) return "Gestor do projeto";
  return member.membershipKind === "external"
    ? "Perfil compartilhado de externos"
    : "Membro interno";
}

export function invitationTag(state: InvitationStatus["state"]): {
  kind: "ok" | "mute" | "warn";
  label: string;
} {
  switch (state) {
    case "accepted":
      return { kind: "ok", label: "Aceito" };
    case "pending":
      return { kind: "mute", label: "Aguardando" };
    case "expired":
      return { kind: "warn", label: "Expirado" };
    default:
      return { kind: "warn", label: "E-mail não entregue" };
  }
}

/** "Interno · enviado há 2 dias · com histórico" */
export function invitationDetail(
  entry: InvitationStatus,
  rel: (iso: string) => string,
): string {
  const kind = entry.membershipKind === "external" ? "Externo" : "Interno";
  const when =
    entry.state === "accepted" && entry.acceptedAt !== undefined
      ? `aceito ${rel(entry.acceptedAt)}`
      : `enviado ${rel(entry.createdAt)}`;
  const history =
    entry.historyMode === "auto"
      ? " · com histórico"
      : entry.historyMode === "none"
        ? " · sem histórico"
        : "";
  return `${kind} · ${when}${history}`;
}

/** The loose check the invite form uses before asking the server. */
export function isValidEmail(value: string): boolean {
  return /^\S+@\S+\.\S+$/.test(value.trim());
}
