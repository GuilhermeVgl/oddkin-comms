import type { CurrentAccount } from "@crewstead/api-client";
import { useEffect, useState } from "react";
import { Icon } from "../design/icons";
import { useMenu } from "../design/Menu";
import { Banner } from "../design/primitives";
import { go } from "../design/router";
import { Sprite } from "../design/Sprite";
import { Page } from "../shell/Page";
import { useShell } from "../shell/context";
import { useWorkspace } from "../workspace";
import { Drawer } from "./Drawer";
import { Board } from "./work/Board";
import { board } from "./work/boardStore";
import { EncryptionBanner } from "./work/EncryptionBanner";
import { EpicsDialog } from "./work/EpicsDialog";
import { FilterMenu } from "./work/FilterMenu";
import { FiltersBar } from "./work/FiltersBar";
import { ListView } from "./work/ListView";
import { NewProjectDialog } from "./work/NewProjectDialog";
import { SkeletonBoard } from "./work/SkeletonBoard";
import { useWorkView } from "./work/useWorkView";

export { board };

function NoProjects({
  account,
  onNewProject,
}: {
  account: CurrentAccount;
  onNewProject: () => void;
}) {
  return (
    <div className="empty">
      <div className="emp-sp">
        <Sprite pose="sleep" scale={4} who="capuz" />
      </div>
      <h3>O mapa está livre</h3>
      <p>
        {account.isAdmin
          ? "Crie o primeiro projeto para começar."
          : "Você ainda não participa de nenhum projeto."}
      </p>
      {account.isAdmin ? (
        <button className="btn primary" onClick={onNewProject} type="button">
          <Icon name="plus" /> Novo projeto
        </button>
      ) : null}
    </div>
  );
}

export function Work({
  account,
  itemId,
}: {
  account: CurrentAccount;
  itemId: string | null;
}) {
  const { projects, current, setCurrentProjectId, sprints } = useWorkspace();
  const { openNewItem } = useShell();
  const [epicsOpen, setEpicsOpen] = useState(false);
  const [newProject, setNewProject] = useState(false);
  const filters = useMenu();
  const { list, all, entries, target, epics, members } = useWorkView(
    account,
    itemId,
  );
  useEffect(() => {
    const open = () => setNewProject(true);
    window.addEventListener("crewstead:new-project", open);
    return () => window.removeEventListener("crewstead:new-project", open);
  }, []);

  const loading = projects === null;
  const everyProject = projects ?? [];

  return (
    <Page
      cta={
        <button
          className="btn primary"
          disabled={everyProject.length === 0}
          onClick={() => openNewItem(current?.project.id)}
          type="button"
        >
          <Icon name="plus" /> Nova atividade
        </button>
      }
      flush
      placeholder="Buscar atividades…"
      sub="Pequenos passos. Grandes entregas."
      title="Atividades"
    >
      <div className="col wk-fill">
        <FiltersBar
          all={all}
          current={current}
          epics={epics}
          filterMenu={filters}
          list={list}
          onPickProject={setCurrentProjectId}
          projects={everyProject}
        />
        {loading ? (
          <SkeletonBoard />
        ) : everyProject.length === 0 ? (
          <NoProjects
            account={account}
            onNewProject={() => setNewProject(true)}
          />
        ) : (
          <>
            {current !== null && !all ? (
              <EncryptionBanner state={current} />
            ) : null}
            {current !== null && !current.canRead ? (
              <div className="wk-note">
                <Banner>
                  Seu perfil neste projeto não permite ver as atividades.
                </Banner>
              </div>
            ) : null}
            {list ? (
              <ListView
                entries={entries}
                onOpen={(entry) => {
                  setCurrentProjectId(entry.state.project.id);
                  go(`work/${entry.item.id}`);
                }}
                showProject={all}
              />
            ) : current === null ? null : (
              <Board
                entries={entries}
                onOpen={(item) => go(`work/${item.id}`)}
                state={current}
              />
            )}
          </>
        )}
      </div>
      {filters.state === null ? null : (
        <FilterMenu
          anchor={filters.state.anchor}
          canManageEpics={
            current?.project.isManager === true || account.isAdmin
          }
          members={members}
          onClose={filters.close}
          onManageEpics={() => setEpicsOpen(true)}
          sprints={sprints}
        />
      )}
      {target === null ? null : (
        <Drawer entry={target} meId={account.id} onClose={() => go("work")} />
      )}
      {epicsOpen && current !== null ? (
        <EpicsDialog onClose={() => setEpicsOpen(false)} state={current} />
      ) : null}
      {newProject ? (
        <NewProjectDialog onClose={() => setNewProject(false)} />
      ) : null}
    </Page>
  );
}
