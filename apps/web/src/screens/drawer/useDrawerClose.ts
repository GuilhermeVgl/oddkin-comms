import { useCallback, useEffect, useState } from "react";
import { isReduced } from "../../design/prefs";

const LEAVE_MS = 150;

/** Closing with the slide-out animation, and Escape as a shortcut unless a dialog or menu is open. */
export function useDrawerClose(onClose: () => void) {
  const [leaving, setLeaving] = useState(false);

  const closeSoon = useCallback(() => {
    if (isReduced()) {
      onClose();
      return;
    }
    setLeaving(true);
    window.setTimeout(onClose, LEAVE_MS);
  }, [onClose]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector("dialog[open], .menu") !== null) return;
      closeSoon();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [closeSoon]);

  return { leaving, closeSoon };
}
