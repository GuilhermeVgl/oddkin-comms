import { Menu } from "../../design/Menu";

const EMOJI = [
  "👍",
  "🙌",
  "🎉",
  "👀",
  "✅",
  "🚀",
  "❤️",
  "😄",
  "🤔",
  "🙏",
  "🔥",
  "👏",
];

/** What an open emoji menu is for: the composer, or reacting to the message with this id. */
export type EmojiTarget = "compose" | string;

export function EmojiMenu({
  anchor,
  target,
  onClose,
  onPick,
}: {
  anchor: HTMLElement;
  target: EmojiTarget;
  onClose: () => void;
  onPick: (symbol: string, target: EmojiTarget) => void;
}) {
  const composing = target === "compose";
  return (
    <Menu anchor={anchor} onClose={onClose} right={!composing} up={composing}>
      <div className="emoji-grid">
        {EMOJI.map((symbol) => (
          <button
            aria-label={`${composing ? "Inserir" : "Reagir com"} ${symbol}`}
            key={symbol}
            onClick={() => {
              onClose();
              onPick(symbol, target);
            }}
            role="menuitem"
            type="button"
          >
            {symbol}
          </button>
        ))}
      </div>
    </Menu>
  );
}
