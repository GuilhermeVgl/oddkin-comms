export function Switch({
  on,
  label,
  onToggle,
}: {
  on: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      aria-checked={on}
      aria-label={label}
      className="sw"
      onClick={onToggle}
      role="switch"
      type="button"
    />
  );
}
