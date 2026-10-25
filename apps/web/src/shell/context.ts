import { createContext, useContext } from "react";

export type ShellApi = {
  openPalette: () => void;
  openNewItem: (projectId?: string) => void;
  /** Reopens the security step (keys, unlocking) over the workspace. */
  openGate: () => void;
  /** True while the browser has no connection. */
  offline: boolean;
};

export const ShellContext = createContext<ShellApi | null>(null);

export function useShell(): ShellApi {
  const value = useContext(ShellContext);
  if (value === null) throw new Error("Shell is missing");
  return value;
}
