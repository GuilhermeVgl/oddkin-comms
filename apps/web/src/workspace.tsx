import {
  ApiStatusError,
  createApiClient,
  getSprintKeyDomain,
  listBoardColumns,
  listEpics,
  listKeyDomains,
  listMembers,
  listProjects,
  listSprints,
  listWorkItems,
  type BoardColumn,
  type CurrentAccount,
  type Epic,
  type Project,
  type ProjectMember,
  type Sprint,
  type WorkItem,
} from "@crewstead/api-client";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "./design/toast";
import { useOptionalE2EE } from "./e2ee/E2EE";
import {
  decryptEpics,
  decryptItems,
  decryptProject,
  decryptSprints,
  type ContentStatus,
} from "./e2ee/content";
import type { ContentCrypto } from "./e2ee/projectCrypto";
import { csrfToken, describeError } from "./errors";
import { useEvents } from "./events";

type Client = ReturnType<typeof createApiClient>;

export type ProjectState = {
  /** With the name and description already decrypted when this browser can. */
  project: Project;
  columns: BoardColumn[];
  /** Tasks and subtasks, decrypted. */
  items: WorkItem[];
  epics: Epic[];
  members: ProjectMember[];
  crypto: ContentCrypto | null;
  status: Map<string, ContentStatus>;
  /** True when the server already refuses plaintext for the work domain. */
  keyed: boolean;
  /** False when the profile cannot read activities of this project. */
  canRead: boolean;
};

export type Person = { id: string; email: string; external: boolean };

type WorkspaceValue = {
  account: CurrentAccount;
  client: Client;
  unlocked: boolean;
  projects: ProjectState[] | null;
  sprints: Sprint[];
  orgCrypto: ContentCrypto | null;
  orgKeyed: boolean;
  people: Map<string, Person>;
  currentProjectId: string | null;
  current: ProjectState | null;
  setCurrentProjectId: (id: string) => void;
  reload: () => Promise<void>;
  /** Puts an activity the server just returned into the board without waiting for a full reload. */
  applyItem: (item: WorkItem) => void;
  /** Runs a mutation, reports a failure as a toast and refreshes the data in the background. */
  run: <T>(action: () => Promise<T>) => Promise<T | undefined>;
};

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (value === null) throw new Error("WorkspaceProvider is missing");
  return value;
}

const CURRENT_KEY = "crewstead.project";

function storedProject(): string | null {
  try {
    return window.localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

function forbidden(error: unknown): boolean {
  return error instanceof ApiStatusError && error.status === 403;
}

/** Whether the person may do something in a project; the server enforces the same rule. */
export function can(state: ProjectState, permission: string): boolean {
  const granted = state.project.permissions as string[] | undefined;
  return granted === undefined || granted.includes(permission);
}

export function isDone(columns: BoardColumn[], columnId: string): boolean {
  return columns.find((column) => column.id === columnId)?.category === "done";
}

/**
 * Everything the screens share: projects with their boards, the sprints and
 * the people. Content is decrypted here, once, so no screen has to know about keys.
 */
export function WorkspaceProvider({
  account,
  children,
}: {
  account: CurrentAccount;
  children: React.ReactNode;
}) {
  const client = useMemo(() => createApiClient(""), []);
  const e2ee = useOptionalE2EE();
  const unlocked = e2ee?.phase === "unlocked";
  // The keys API is a new object whenever any of its state changes; reading it
  // through a ref keeps a reload from restarting for reasons unrelated to content.
  const e2eeRef = useRef(e2ee);
  e2eeRef.current = e2ee;
  const [projects, setProjects] = useState<ProjectState[] | null>(null);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [orgCrypto, setOrgCrypto] = useState<ContentCrypto | null>(null);
  const [orgKeyed, setOrgKeyed] = useState(false);
  const [currentProjectId, setCurrent] = useState<string | null>(storedProject);
  const running = useRef(false);
  const dirty = useRef(false);

  const load = useCallback(async () => {
    const e2ee = e2eeRef.current;
    const raw = await listProjects(client);
    const organization =
      unlocked && e2ee !== null
        ? await e2ee.openOrganization({ maintain: true }).catch(() => null)
        : null;
    const states = await Promise.all(
      raw.map(async (entry): Promise<ProjectState> => {
        const crypto =
          unlocked && e2ee !== null
            ? await e2ee
                .openProject(entry.id, { maintain: true })
                .catch(() => null)
            : null;
        const project = entry.encrypted
          ? await decryptProject(crypto, entry)
          : entry;
        const [domains, columns, work, epics, members] = await Promise.all([
          listKeyDomains(client, entry.id).catch(() => []),
          listBoardColumns(client, entry.id).catch(() => []),
          listWorkItems(client, entry.id).then(
            (value) => ({ ok: true as const, value }),
            (error: unknown) => {
              if (forbidden(error)) return { ok: false as const };
              throw error;
            },
          ),
          listEpics(client, entry.id).catch(() => []),
          listMembers(client, entry.id).catch(() => []),
        ]);
        const decoded = await decryptItems(crypto, work.ok ? work.value : []);
        const decodedEpics = await decryptEpics(crypto, epics);
        return {
          project,
          columns: [...columns].sort((a, b) => a.position - b.position),
          items: decoded.items,
          epics: decodedEpics.epics,
          members,
          crypto,
          status: new Map([...decoded.status, ...decodedEpics.status]),
          keyed: domains.some(
            (domain) => domain.kind === "work" && domain.currentGeneration > 0,
          ),
          canRead: work.ok,
        };
      }),
    );
    const [rawSprints, sprintDomain] = await Promise.all([
      listSprints(client),
      getSprintKeyDomain(client).catch(() => null),
    ]);
    const decoded = await decryptSprints(organization, rawSprints);
    setProjects(states);
    setSprints(decoded);
    setOrgCrypto(organization);
    setOrgKeyed((sprintDomain?.currentGeneration ?? 0) > 0);
    setCurrent((value) =>
      value !== null && states.some((state) => state.project.id === value)
        ? value
        : (states[0]?.project.id ?? null),
    );
  }, [client, unlocked]);

  // Reloads are coalesced: a burst of events costs one extra pass, not one each.
  const reload = useCallback(async () => {
    if (running.current) {
      dirty.current = true;
      return;
    }
    running.current = true;
    try {
      do {
        dirty.current = false;
        try {
          await load();
        } catch {
          setProjects((current) => current ?? []);
        }
      } while (dirty.current);
    } finally {
      running.current = false;
    }
  }, [load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEvents((event) => {
    if (event === "resync") {
      void reload();
      return;
    }
    if (
      [
        "work-item.changed",
        "policy.changed",
        "key-domain.changed",
        "sprint.changed",
        "project.changed",
      ].includes(event.eventType)
    ) {
      void reload();
    }
  });

  const applyItem = useCallback((item: WorkItem) => {
    setProjects((current) =>
      current === null
        ? current
        : current.map((state) => {
            if (state.project.id !== item.projectId) return state;
            const known = state.items.some((entry) => entry.id === item.id);
            // The server returns the item as stored: encrypted fields stay as they were read.
            const previous = state.items.find((entry) => entry.id === item.id);
            const merged: WorkItem =
              previous !== undefined && item.encrypted
                ? {
                    ...item,
                    title: previous.title,
                    description: previous.description,
                  }
                : item;
            return {
              ...state,
              items: known
                ? state.items.map((entry) =>
                    entry.id === item.id ? merged : entry,
                  )
                : state.items,
            };
          }),
    );
  }, []);

  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
      try {
        const result = await action();
        void reload();
        return result;
      } catch (error) {
        toast(describeError(error), { kind: "err", ms: 5200 });
        void reload();
        return undefined;
      }
    },
    [reload],
  );

  const setCurrentProjectId = useCallback((id: string) => {
    setCurrent(id);
    try {
      window.localStorage.setItem(CURRENT_KEY, id);
    } catch {
      // The selection then lasts for this session only.
    }
  }, []);

  const people = useMemo(() => {
    const map = new Map<string, Person>();
    map.set(account.id, {
      id: account.id,
      email: account.email,
      external: account.membershipKind === "external",
    });
    for (const state of projects ?? []) {
      for (const member of state.members) {
        map.set(member.accountId, {
          id: member.accountId,
          email: member.email,
          external: member.membershipKind === "external",
        });
      }
    }
    return map;
  }, [account, projects]);

  const current =
    projects?.find((state) => state.project.id === currentProjectId) ??
    projects?.[0] ??
    null;

  const value = useMemo<WorkspaceValue>(
    () => ({
      account,
      client,
      unlocked,
      projects,
      sprints,
      orgCrypto,
      orgKeyed,
      people,
      currentProjectId: current?.project.id ?? null,
      current,
      setCurrentProjectId,
      reload,
      applyItem,
      run,
    }),
    [
      account,
      client,
      unlocked,
      projects,
      sprints,
      orgCrypto,
      orgKeyed,
      people,
      current,
      setCurrentProjectId,
      reload,
      applyItem,
      run,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export { csrfToken };
