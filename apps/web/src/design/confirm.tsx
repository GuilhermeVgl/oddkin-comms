import { useSyncExternalStore, type ReactNode } from "react";
import { Modal } from "./Modal";

export type ConfirmOptions = {
  title: string;
  body: ReactNode;
  ok?: string;
  cancel?: string;
  extra?: string[];
  danger?: boolean;
  width?: string;
};

/** true for the main button, false for cancel, or the label index like "x0" for an extra one. */
export type ConfirmResult = boolean | string;

type Pending = {
  id: number;
  options: ConfirmOptions;
  resolve: (value: ConfirmResult) => void;
};

let pending: Pending[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function confirmDialog(options: ConfirmOptions): Promise<ConfirmResult> {
  return new Promise((resolve) => {
    pending = [...pending, { id: nextId++, options, resolve }];
    emit();
  });
}

function finish(id: number, value: ConfirmResult) {
  const found = pending.find((entry) => entry.id === id);
  if (found === undefined) return;
  pending = pending.filter((entry) => entry.id !== id);
  emit();
  found.resolve(value);
}

export function ConfirmHost() {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pending,
  );
  return (
    <>
      {current.map(({ id, options }) => (
        <Modal
          key={id}
          onClose={() => finish(id, false)}
          width={options.width ?? "480px"}
        >
          <div className="dh">
            <h2 id="dlgt">{options.title}</h2>
          </div>
          <div className="dbd">{options.body}</div>
          <div className="dft">
            <button
              className="btn"
              onClick={() => finish(id, false)}
              type="button"
            >
              {options.cancel ?? "Cancelar"}
            </button>
            {(options.extra ?? []).map((label, index) => (
              <button
                className="btn"
                key={label}
                onClick={() => finish(id, `x${index}`)}
                type="button"
              >
                {label}
              </button>
            ))}
            <button
              autoFocus
              className={`btn ${options.danger === true ? "danger" : "primary"}`}
              onClick={() => finish(id, true)}
              type="button"
            >
              {options.ok ?? "Confirmar"}
            </button>
          </div>
        </Modal>
      ))}
    </>
  );
}
