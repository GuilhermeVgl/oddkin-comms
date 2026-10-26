import { getMyStats, type MyStats } from "@crewstead/api-client";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { newlyEarned, earnedIds, streakLabel } from "../design/gamify";
import { blip } from "../design/sound";
import { burst } from "../design/sprites";
import { toast } from "../design/toast";
import { useEvents } from "../events";
import { useWorkspace } from "../workspace";
import { go } from "../design/router";
import { localStore } from "../design/safeStorage";

type StatsValue = {
  stats: MyStats | null;
  refresh: () => Promise<void>;
};

const StatsContext = createContext<StatsValue | null>(null);

export function useStats(): StatsValue {
  const value = useContext(StatsContext);
  if (value === null) throw new Error("StatsProvider is missing");
  return value;
}

function readAnnounced(key: string): string[] | null {
  const parsed = localStore.getJSON(key);
  return Array.isArray(parsed)
    ? parsed.filter((entry): entry is string => typeof entry === "string")
    : null;
}

function writeAnnounced(key: string, ids: string[]) {
  // If storage is blocked the badges just show again next time.
  localStore.setJSON(key, ids);
}

/**
 * The person's own scoreboard, kept fresh as work moves, plus the little
 * moments it triggers: a new badge, a longer streak.
 */
export function StatsProvider({
  accountId,
  children,
}: {
  accountId: string;
  children: React.ReactNode;
}) {
  const { client } = useWorkspace();
  const [stats, setStats] = useState<MyStats | null>(null);
  const previous = useRef<MyStats | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const announce = useCallback(
    (next: MyStats) => {
      const key = `crewstead.achievements.${accountId}`;
      const known = readAnnounced(key);
      if (known === null) {
        // First reading on this browser: remember, do not flood.
        writeAnnounced(key, earnedIds(next));
        return;
      }
      const fresh = newlyEarned(next, known);
      if (fresh.length === 0) return;
      writeAnnounced(key, [...known, ...fresh.map((entry) => entry.id)]);
      fresh.forEach((entry, index) => {
        window.setTimeout(() => {
          blip("win");
          burst(window.innerWidth / 2, window.innerHeight - 90, {
            count: 40,
            power: 9,
            up: true,
          });
          toast(`Conquista: ${entry.title}`, {
            icon: entry.icon,
            ms: 4500,
            act: ["Ver", () => go("settings/perfil")],
          });
        }, 600 * index);
      });
    },
    [accountId],
  );

  const refresh = useCallback(async () => {
    try {
      const next = await getMyStats(client);
      const before = previous.current;
      previous.current = next;
      setStats(next);
      announce(next);
      if (before !== null && next.currentStreak > before.currentStreak) {
        toast(`Sequência: ${streakLabel(next.currentStreak)}.`, {
          icon: "bell",
          ms: 3600,
        });
      }
    } catch {
      // The scoreboard is a nicety; the next change refreshes it.
    }
  }, [client, announce]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEvents((event) => {
    if (
      event === "resync" ||
      ["work-item.changed", "notification.created", "call.changed"].includes(
        event.eventType,
      )
    ) {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void refresh(), 700);
    }
  });

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const value = useMemo(() => ({ stats, refresh }), [stats, refresh]);
  return (
    <StatsContext.Provider value={value}>{children}</StatsContext.Provider>
  );
}
