import { useSyncExternalStore } from "react";

export type Theme = "papel" | "carvao";

export type Prefs = {
  theme: Theme;
  /** Animations on. Off swaps movement for a light fade. */
  motion: boolean;
  /** Short beeps. Off until the person turns it on. */
  sound: boolean;
};

const KEY = "crewstead.prefs.v1";
const defaults: Prefs = { theme: "papel", motion: true, sound: false };

function read(): Prefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return defaults;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return defaults;
    const record = parsed as Record<string, unknown>;
    return {
      theme: record["theme"] === "carvao" ? "carvao" : "papel",
      motion: record["motion"] !== false,
      sound: record["sound"] === true,
    };
  } catch {
    return defaults;
  }
}

let current: Prefs = read();
const listeners = new Set<() => void>();
const motionListeners = new Set<() => void>();

function apply() {
  const root = document.documentElement;
  if (current.theme === "carvao") root.dataset["theme"] = "carvao";
  else delete root.dataset["theme"];
  root.dataset["motion"] = current.motion ? "on" : "off";
}

export function getPrefs(): Prefs {
  return current;
}

export function setPrefs(patch: Partial<Prefs>) {
  current = { ...current, ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage can be blocked; the preference then lasts for this session.
  }
  apply();
  listeners.forEach((listener) => listener());
  if (patch.motion !== undefined) motionListeners.forEach((fn) => fn());
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}

/** Calls `fn` when the user's own motion preference changes. */
export function onMotionChange(fn: () => void): () => void {
  motionListeners.add(fn);
  return () => motionListeners.delete(fn);
}

const query =
  typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

/** True when the system or the person asked for less movement. */
export function isReduced(): boolean {
  return !current.motion || (query?.matches ?? false);
}

apply();
