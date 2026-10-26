import { useSyncExternalStore } from "react";
import { localStore } from "./safeStorage";

const KEY = "crewstead.showDuo";
let visible = localStore.get(KEY) !== "false";
const listeners = new Set<() => void>();

export function setDuoVisible(next: boolean) {
  visible = next;
  localStore.set(KEY, String(next));
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
