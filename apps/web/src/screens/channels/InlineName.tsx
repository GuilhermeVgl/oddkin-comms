import { useEffect, useRef } from "react";

/** A text field that saves on Enter or when it loses focus, and cancels on Escape. */
export function InlineName({
  initial,
  label,
  placeholder,
  onSave,
  onCancel,
}: {
  initial: string;
  label: string;
  placeholder?: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const settled = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (save: boolean) => {
    if (settled.current) return;
    settled.current = true;
    if (save) onSave(input.current?.value ?? "");
    else onCancel();
  };
  return (
    <input
      aria-label={label}
      className="crow-input"
      defaultValue={initial}
      maxLength={60}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      }}
      placeholder={placeholder}
      ref={input}
    />
  );
}
