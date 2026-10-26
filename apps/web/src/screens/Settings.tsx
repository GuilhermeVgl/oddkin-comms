import type { CurrentAccount } from "@crewstead/api-client";
import { go } from "../design/router";
import { Page } from "../shell/Page";
import { useWorkspace } from "../workspace";
import { ColumnsTab } from "./settings/ColumnsTab";
import { DevicesTab } from "./settings/DevicesTab";
import { PeopleTab } from "./settings/PeopleTab";
import { ProfileTab } from "./settings/ProfileTab";
import { RecoveryTab } from "./settings/RecoveryTab";
import { StorageTab } from "./settings/StorageTab";
import { activeTab, visibleTabs } from "./settings/tabs";
import { TeamBrandingTab } from "./settings/TeamBrandingTab";

export function Settings({
  account,
  tab,
  onLogout,
}: {
  account: CurrentAccount;
  tab: string | null;
  onLogout: () => void;
}) {
  const { projects } = useWorkspace();
  const manager =
    account.isAdmin ||
    (projects ?? []).some((state) => state.project.isManager);
  const tabs = visibleTabs({ isAdmin: account.isAdmin, manager });
  const active = activeTab(tabs, tab);
  return (
    <Page
      sub="Perfil, dispositivos, colunas, armazenamento e recuperação, conforme seu papel."
      title="Configurações"
    >
      <div className="tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button
            aria-selected={id === active}
            key={id}
            onClick={() => go(`settings/${id}`)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      <div className="st-narrow">
        {active === "perfil" ? <ProfileTab account={account} /> : null}
        {active === "equipe" ? <TeamBrandingTab /> : null}
        {active === "dispositivos" ? (
          <DevicesTab account={account} onLogout={onLogout} />
        ) : null}
        {active === "colunas" ? <ColumnsTab /> : null}
        {active === "pessoas" ? <PeopleTab account={account} /> : null}
        {active === "armazenamento" ? (
          <StorageTab isAdmin={account.isAdmin} />
        ) : null}
        {active === "recuperacao" ? <RecoveryTab /> : null}
      </div>
    </Page>
  );
}
