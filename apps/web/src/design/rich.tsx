import type { ReactNode } from "react";

/**
 * Light formatting for comments and messages: `code`, **bold** and @mentions.
 * Everything is rendered as React nodes, never as HTML.
 */
export function Rich({
  text,
  mentions,
}: {
  text: string;
  mentions?: ReadonlySet<string>;
}) {
  const parts: ReactNode[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|@([A-ZÀ-Ú][\wà-ú]+)/g;
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    if (match[1] !== undefined) parts.push(<code key={key++}>{match[1]}</code>);
    else if (match[2] !== undefined) parts.push(<b key={key++}>{match[2]}</b>);
    else if (
      match[3] !== undefined &&
      (mentions === undefined || mentions.has(match[3]))
    ) {
      parts.push(
        <span className="men" key={key++}>
          @{match[3]}
        </span>,
      );
    } else parts.push(match[0]);
    last = index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
