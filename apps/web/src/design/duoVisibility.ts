import { useSyncExternalStore } from "react";

const KEY = "crewstead.showDuo";
let visible = (() => {
  try {
    return window.localStorage.getItem(KEY) !== "false";
  } catch {
    return true;
  }
})();
const listeners = new Set<() => void>();

export function setDuoVisible(next: boolean) {
  visible = next;
  try {
    window.localStorage.setItem(KEY, String(next));
  } catch {
    // The choice still lasts until this page is closed.
  }
  listeners.forEach((listener) => listener());
}

export function getDuoVisible(): boolean {
  return visible;
}

export function useDuoVisible(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => visible,
  );
}
