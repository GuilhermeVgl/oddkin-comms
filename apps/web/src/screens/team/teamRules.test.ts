import type { InvitationStatus, ProjectMember } from "@crewstead/api-client";
import { describe, expect, it } from "vitest";
import {
  canInviteToProject,
  invitationDetail,
  invitationTag,
  isValidEmail,
  memberRoleLabel,
  normalizePermissions,
  policyDirty,
  togglePermission,
} from "./teamRules";

describe("normalizePermissions", () => {
  it("drops permissions whose requirement is missing", () => {
    const kept = normalizePermissions(["work.edit", "chat.send", "chat.read"]);
    expect([...kept].sort()).toEqual(["chat.read", "chat.send"]);
  });
  it("follows chains until nothing depends on a missing permission", () => {
    expect(normalizePermissions(["work.create", "files.upload"]).size).toBe(0);
  });
  it("keeps a consistent set untouched", () => {
    expect(normalizePermissions(["work.read", "work.edit"]).size).toBe(2);
  });
});

describe("togglePermission", () => {
  it("adds a permission that was off", () => {
    expect(togglePermission(["work.read"], "work.edit").sort()).toEqual([
      "work.edit",
      "work.read",
    ]);
  });
  it("removes a permission together with the ones that need it", () => {
    expect(
      togglePermission(["work.read", "work.edit", "chat.read"], "work.read"),
    ).toEqual(["chat.read"]);
  });
});

describe("policyDirty", () => {
  it("compares the saved permissions with the normalised draft", () => {
    expect(policyDirty(null, new Set())).toBe(false);
    expect(policyDirty(["work.read"], new Set(["work.read"]))).toBe(false);
    expect(policyDirty(["work.read"], new Set())).toBe(true);
    expect(policyDirty([], new Set(["work.read"]))).toBe(true);
  });
});

describe("canInviteToProject", () => {
  const admin = { isAdmin: true, membershipKind: "internal" } as const;
  const member = { isAdmin: false, membershipKind: "internal" } as const;
  const external = { isAdmin: false, membershipKind: "external" } as const;
  it("always lets administrators invite", () => {
    expect(
      canInviteToProject(admin, { isManager: false, policy: "admins" }),
    ).toBe(true);
  });
  it("follows the project policy for internal people", () => {
    expect(
      canInviteToProject(member, { isManager: true, policy: "admins" }),
    ).toBe(false);
    expect(
      canInviteToProject(member, { isManager: true, policy: "managers" }),
    ).toBe(true);
    expect(
      canInviteToProject(member, { isManager: false, policy: "managers" }),
    ).toBe(false);
    expect(
      canInviteToProject(member, { isManager: false, policy: "members" }),
    ).toBe(true);
  });
  it("never lets externals invite", () => {
    expect(
      canInviteToProject(external, { isManager: true, policy: "members" }),
    ).toBe(false);
  });
});

describe("memberRoleLabel", () => {
  const member = (patch: Partial<ProjectMember>) =>
    ({
      isManager: false,
      membershipKind: "internal",
      ...patch,
    }) as ProjectMember;
  it("describes managers, externals and members", () => {
    expect(memberRoleLabel(member({ isManager: true }))).toBe(
      "Gestor do projeto",
    );
    expect(memberRoleLabel(member({ membershipKind: "external" }))).toBe(
      "Perfil compartilhado de externos",
    );
    expect(memberRoleLabel(member({}))).toBe("Membro interno");
  });
});

describe("invitation labels", () => {
  const entry = (patch: Partial<InvitationStatus>) =>
    ({
      state: "pending",
      membershipKind: "internal",
      createdAt: "2026-01-01T00:00:00Z",
      ...patch,
    }) as InvitationStatus;
  it("maps each state to a tag", () => {
    expect(invitationTag("accepted")).toEqual({ kind: "ok", label: "Aceito" });
    expect(invitationTag("pending")).toEqual({
      kind: "mute",
      label: "Aguardando",
    });
    expect(invitationTag("expired")).toEqual({
      kind: "warn",
      label: "Expirado",
    });
    expect(invitationTag("failed")).toEqual({
      kind: "warn",
      label: "E-mail não entregue",
    });
  });
  it("adds the history mode to the detail line", () => {
    const rel = (value: string) => `rel(${value})`;
    expect(invitationDetail(entry({}), rel)).toBe(
      "Interno · enviado rel(2026-01-01T00:00:00Z)",
    );
    expect(
      invitationDetail(
        entry({
          membershipKind: "external",
          state: "accepted",
          acceptedAt: "2026-02-01T00:00:00Z",
          historyMode: "auto",
        }),
        rel,
      ),
    ).toBe("Externo · aceito rel(2026-02-01T00:00:00Z) · com histórico");
    expect(invitationDetail(entry({ historyMode: "none" }), rel)).toContain(
      "sem histórico",
    );
  });
});

describe("isValidEmail", () => {
  it("accepts something@host.tld and ignores surrounding spaces", () => {
    expect(isValidEmail(" ana@empresa.com ")).toBe(true);
    expect(isValidEmail("ana@empresa")).toBe(false);
    expect(isValidEmail("ana empresa@x.com")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});
