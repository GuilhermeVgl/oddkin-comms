import { fingerprintCells } from "./rules";

/** A fingerprint as text plus a small grid to compare at a glance. */
export function FingerprintCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="card pad row fpcard">
      <div aria-hidden="true" className="fpgrid">
        {fingerprintCells(value).map((cell, index) => (
          <i
            className={cell === 1 ? undefined : "dim"}
            key={index}
            style={{ animationDelay: `${index * 40}ms` }}
          />
        ))}
      </div>
      <div className="col gap4">
        <span className="lbl">{label}</span>
        <span className="fp">{value}</span>
        <span className="xs muted">{hint}</span>
      </div>
    </div>
  );
}
