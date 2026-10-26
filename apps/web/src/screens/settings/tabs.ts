export const TABS = [
  ["perfil", "Perfil e aparência"],
  ["equipe", "Equipe"],
  ["dispositivos", "Dispositivos"],
  ["colunas", "Colunas"],
  ["pessoas", "Pessoas"],
  ["armazenamento", "Armazenamento"],
  ["recuperacao", "Recuperação"],
] as const;

export type Tab = (typeof TABS)[number][0];
export type TabEntry = (typeof TABS)[number];

/** The tabs a person may open: some are for administrators or project managers only. */
export function visibleTabs(who: {
  isAdmin: boolean;
  manager: boolean;
}): TabEntry[] {
  return TABS.filter(
    ([id]) =>
      (id !== "colunas" || who.manager) &&
      (id !== "pessoas" || who.isAdmin) &&
      (id !== "equipe" || who.isAdmin) &&
      (id !== "recuperacao" || who.isAdmin),
  );
}

/** The tab to show for the route argument, or the profile when it is unknown or hidden. */
export function activeTab(
  tabs: readonly TabEntry[],
  wanted: string | null,
): Tab {
  return tabs.find(([id]) => id === wanted)?.[0] ?? "perfil";
}
