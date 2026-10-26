import type { CurrentAccount } from "@crewstead/api-client";
import { useEffect, useMemo } from "react";
import { isDone } from "../columns";
import { fmtLong, greeting, todayIso } from "../design/format";
import { Icon } from "../design/icons";
import { firstNameOf } from "../design/people";
import { Page } from "../shell/Page";
import { useShell } from "../shell/context";
import { useWorkspace } from "../workspace";
import { APP_NAME } from "../brand";
import { DayCard } from "./home/DayCard";
import { MyQueue } from "./home/MyQueue";
import { ProjectsCard } from "./home/ProjectsCard";
import { RecentActivity } from "./home/RecentActivity";
import { NoSprintHero, SprintHero } from "./home/SprintHero";
import {
  countOpenToday,
  countUpcoming,
  myQueue,
  recentActivity,
} from "./home/homeRules";
import { PRIORITY_ICON, PRIORITY_LABEL } from "./priority";
import { taskEntries } from "./work/workRules";

export { PRIORITY_ICON, PRIORITY_LABEL };

/** The subtitle under the greeting: how long the person's queue is. */
function queueSummary(queueLength: number, upcoming: number): string {
  if (queueLength === 0) return "Sua fila está limpa.";
  return `Você tem ${queueLength} ${queueLength === 1 ? "item" : "itens"} na fila${
    upcoming > 0 ? `, ${upcoming} com prazo curto` : ""
  }.`;
}

export function Home({ account }: { account: CurrentAccount }) {
  const { projects, sprints } = useWorkspace();
  const { openNewItem } = useShell();
  const loading = projects === null;
  const items = useMemo(() => taskEntries(projects ?? []), [projects]);
  const mine = myQueue(items, account.id);
  const active = sprints.find((sprint) => sprint.state === "active");
  const inSprint =
    active === undefined
      ? []
      : items.filter(({ item }) => item.sprintId === active.id);
  const finished = inSprint.filter(({ item, state }) =>
    isDone(state.columns, item.columnId),
  ).length;
  const todayOpen = countOpenToday(mine, todayIso());
  const upcoming = countUpcoming(mine);
  const canCreate = (projects ?? []).length > 0;

  useEffect(() => {
    document.title = `${APP_NAME} · Visão geral`;
  }, []);

  return (
    <Page
      cta={
        canCreate ? (
          <button
            className="btn primary"
            onClick={() => openNewItem()}
            type="button"
          >
            <Icon name="plus" /> Nova atividade
          </button>
        ) : null
      }
      sub={`${fmtLong(todayIso())}. ${
        loading ? "" : queueSummary(mine.length, upcoming)
      }`}
      title={`${greeting()}, ${firstNameOf(account.email)}`}
    >
      <div className="grid2">
        <div className="stack">
          {loading ? null : (
            <DayCard
              open={todayOpen}
              quiet={mine.length > 0 && todayOpen === 0}
            />
          )}
          {active === undefined ? (
            <NoSprintHero />
          ) : (
            <SprintHero
              done={finished}
              projectNames={[
                ...new Set(inSprint.map(({ state }) => state.project.name)),
              ]}
              sprint={active}
              total={inSprint.length}
            />
          )}
          <MyQueue loading={loading} queue={mine} />
        </div>
        <div className="stack">
          <ProjectsCard account={account} loading={loading} />
          <RecentActivity feed={recentActivity(items, 5)} />
        </div>
      </div>
    </Page>
  );
}
