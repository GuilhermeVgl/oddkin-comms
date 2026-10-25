import { useEffect, useRef, type ReactNode } from "react";

/** A native modal dialog. Render it only while it is open. */
export function Modal({
  onClose,
  width,
  children,
  label,
}: {
  onClose: () => void;
  width?: string;
  children: ReactNode;
  label?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (!element.open) element.showModal();
    const closed = () => onClose();
    element.addEventListener("close", closed);
    return () => element.removeEventListener("close", closed);
  }, [onClose]);

  return (
    <dialog
      aria-label={label}
      aria-labelledby={label === undefined ? "dlgt" : undefined}
      onClick={(event) => {
        if (event.target === dialog.current) dialog.current?.close();
      }}
      ref={dialog}
      style={width === undefined ? undefined : { maxWidth: width }}
    >
      {children}
    </dialog>
  );
}
