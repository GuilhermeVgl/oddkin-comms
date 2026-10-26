import { useCallback, useRef } from "react";

const NEAR_BOTTOM_PX = 80;

/**
 * Keeps a scrolling list pinned to its bottom while the person has not
 * scrolled up. Call `follow` from a layout effect when the content changes.
 */
export function useStickToBottom() {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const follow = useCallback(() => {
    const element = box.current;
    if (element !== null && stick.current)
      element.scrollTop = element.scrollHeight;
  }, []);

  const onScroll = useCallback((element: HTMLElement) => {
    stick.current =
      element.scrollHeight - element.scrollTop - element.clientHeight <
      NEAR_BOTTOM_PX;
  }, []);

  /** Scroll to the bottom on the next `follow`, whatever the position now. */
  const pin = useCallback(() => {
    stick.current = true;
  }, []);

  return { box, follow, onScroll, pin };
}
