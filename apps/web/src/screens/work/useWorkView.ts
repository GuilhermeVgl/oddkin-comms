import type { CurrentAccount } from "@crewstead/api-client";
import { useEffect, useMemo } from "react";
import { useWorkspace } from "../../workspace";
import { board } from "./boardStore";
import { filterEntries, findItemTarget, taskEntries } from "./workRules";

/** What the Work screen shows: filtered rows, the epics and people to filter by, and the deep-linked item. */
export function useWorkView(account: CurrentAccount, itemId: string | null) {
  const { projects, current, setCurrentProjectId } = useWorkspace();
  const prefs = board.use();
  const list = prefs.view === "lista";
  const all = list && prefs.allProjects;
  const states = useMemo(
    () => (all ? (projects ?? []) : current === null ? [] : [current]),
    [all, projects, current],
  );

  const entries = useMemo(
    () =>
      filterEntries(
        taskEntries(states),
        {
          scope: prefs.scope,
          epic: prefs.epic,
          prio: prefs.prio,
          assignee: prefs.assignee,
          sprint: prefs.sprint,
        },
        account.id,
      ),
    [
      states,
      prefs.scope,
      prefs.epic,
      prefs.prio,
      prefs.assignee,
      prefs.sprint,
      account.id,
    ],
  );

  // A deep link to an activity opens its drawer and selects its project.
  const target = useMemo(
    () => findItemTarget(projects, itemId),
    [itemId, projects],
  );
  useEffect(() => {
    if (target !== null && target.state.project.id !== current?.project.id)
      setCurrentProjectId(target.state.project.id);
  }, [target, current, setCurrentProjectId]);

  const epics = states.flatMap((state) => state.epics);
  const members = new Map<string, string>();
  for (const state of states)
    for (const member of state.members)
      members.set(member.accountId, member.email);

  return { list, all, entries, target, epics, members };
}
