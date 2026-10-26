import { describe, expect, it } from "vitest";
import { activeTab, visibleTabs } from "./tabs";

const ids = (admin: boolean, manager: boolean) =>
  visibleTabs({ isAdmin: admin, manager }).map(([id]) => id);

describe("visibleTabs", () => {
  it("shows only the common tabs to a regular member", () => {
    expect(ids(false, false)).toEqual([
      "perfil",
      "dispositivos",
      "armazenamento",
    ]);
  });
  it("adds columns for project managers", () => {
    expect(ids(false, true)).toContain("colunas");
    expect(ids(false, true)).not.toContain("pessoas");
  });
  it("shows everything to administrators", () => {
    expect(ids(true, true)).toEqual([
      "perfil",
      "equipe",
      "dispositivos",
      "colunas",
      "pessoas",
      "armazenamento",
      "recuperacao",
    ]);
  });
});

describe("activeTab", () => {
  const tabs = visibleTabs({ isAdmin: false, manager: false });
  it("keeps a tab the person can see", () => {
    expect(activeTab(tabs, "dispositivos")).toBe("dispositivos");
  });
  it("falls back to the profile for unknown or hidden tabs", () => {
    expect(activeTab(tabs, "pessoas")).toBe("perfil");
    expect(activeTab(tabs, null)).toBe("perfil");
  });
});
