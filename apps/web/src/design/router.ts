import { useSyncExternalStore } from "react";

export type RouteName =
  "home" | "work" | "sprints" | "chat" | "team" | "settings";
export type Route = { name: RouteName; arg: string | null };

const NAMES: RouteName[] = [
  "home",
  "work",
  "sprints",
  "chat",
  "team",
  "settings",
];

function parse(): Route {
  const parts = window.location.hash.replace(/^#\/?/, "").split("/");
  const name = NAMES.find((candidate) => candidate === parts[0]) ?? "home";
  const arg = parts.slice(1).join("/");
  return { name, arg: arg === "" ? null : arg };
}

let current = parse();
const listeners = new Set<() => void>();

window.addEventListener("hashchange", () => {
  current = parse();
  listeners.forEach((listener) => listener());
});

export function useRoute(): Route {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}

export function go(path: string) {
  const target = `#/${path}`;
  if (window.location.hash !== target) window.location.hash = target;
}
