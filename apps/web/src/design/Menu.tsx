import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type Anchor = HTMLElement | DOMRect;

/** A floating menu anchored to an element. Closes on outside click and Escape. */
export function Menu({
  anchor,
  onClose,
  children,
  right = false,
  up = false,
  className = "",
  focusFirst = true,
  label,
}: {
  anchor: Anchor;
  onClose: () => void;
  children: ReactNode;
  right?: boolean;
  up?: boolean;
  className?: string;
  focusFirst?: boolean;
  label?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);

  useLayoutEffect(() => {
    const element = box.current;
    if (element === null) return;
    const rect =
      anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    let left = right ? rect.right - width : rect.left;
    let top = up ? rect.top - height - 6 : rect.bottom + 6;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    if (top + height > window.innerHeight - 8)
      top = Math.max(8, rect.top - height - 6);
    setPosition({ left, top });
  }, [anchor, right, up]);

  useEffect(() => {
    if (focusFirst)
      box.current?.querySelector<HTMLElement>("button,a")?.focus();
  }, [focusFirst]);

  useEffect(() => {
    const down = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (box.current?.contains(target) === true) return;
      if (anchor instanceof HTMLElement && anchor.contains(target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [anchor, onClose]);

  const keydown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const buttons = Array.from(
        box.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ??
          [],
      );
      const index = buttons.indexOf(document.activeElement as HTMLElement);
      if (event.key === "ArrowDown" && buttons.length > 0) {
        event.preventDefault();
        buttons[(index + 1) % buttons.length]?.focus();
      }
      if (event.key === "ArrowUp" && buttons.length > 0) {
        event.preventDefault();
        buttons[(index - 1 + buttons.length) % buttons.length]?.focus();
      }
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        if (anchor instanceof HTMLElement) anchor.focus();
      }
    },
    [anchor, onClose],
  );

  return createPortal(
    <div
      aria-label={label}
      className={`menu ${className}`}
      onKeyDown={keydown}
      ref={box}
      role="menu"
      style={
        position === null
          ? { left: 0, top: 0, visibility: "hidden" }
          : { left: position.left, top: position.top }
      }
    >
      {children}
    </div>,
    document.body,
  );
}

/** Holds which menu is open and where it is anchored. */
export function useMenu<T = undefined>() {
  const [state, setState] = useState<{ anchor: HTMLElement; data: T } | null>(
    null,
  );
  const close = useCallback(() => setState(null), []);
  const toggle = useCallback((anchor: HTMLElement, data: T) => {
    setState((current) =>
      current?.anchor === anchor ? null : { anchor, data },
    );
  }, []);
  return { state, close, toggle };
}
