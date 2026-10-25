import { useSyncExternalStore } from "react";
import { Icon, type IconName } from "./icons";
import { Sprite } from "./Sprite";
import type { PoseName, Who } from "./sprites";

export type ToastOptions = {
  kind?: "err";
  icon?: IconName;
  mascot?: Who;
  pose?: PoseName;
  act?: [string, () => void];
  ms?: number;
};

type Item = {
  id: number;
  message: string;
  options: ToastOptions;
  out: boolean;
};

let items: Item[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function dismiss(id: number) {
  items = items.map((item) => (item.id === id ? { ...item, out: true } : item));
  emit();
  window.setTimeout(() => {
    items = items.filter((item) => item.id !== id);
    emit();
  }, 170);
}

/** Shows a short message at the bottom of the screen. */
export function toast(message: string, options: ToastOptions = {}) {
  const id = nextId++;
  items = [...items, { id, message, options, out: false }];
  emit();
  window.setTimeout(() => dismiss(id), options.ms ?? 3800);
}

export function ToastHost() {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => items,
  );
  return (
    <div aria-live="polite" className="toasts" role="status">
      {current.map(({ id, message, options, out }) => (
        <div
          className={`toast ${options.kind ?? ""}${options.mascot === undefined ? "" : " mascot"}${out ? " out" : ""}`}
          key={id}
        >
          {options.mascot === undefined ? (
            <Icon
              name={
                options.kind === "err" ? "alert" : (options.icon ?? "check")
              }
            />
          ) : (
            <span className="mh">
              <Sprite
                pose={options.pose ?? "cheer"}
                scale={2}
                who={options.mascot}
              />
            </span>
          )}
          <span className={options.mascot === undefined ? "" : "px"}>
            {message}
          </span>
          {options.act === undefined ? null : (
            <button
              className="act"
              onClick={() => {
                options.act?.[1]();
                dismiss(id);
              }}
              type="button"
            >
              {options.act[0]}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
