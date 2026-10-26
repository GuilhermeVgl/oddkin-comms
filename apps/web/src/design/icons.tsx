import { ICONS, type IconName } from "./icon-paths";

export type { IconName };

/** Line icon. The paths are static strings from this repository, never user input. */
export function Icon({ name, size }: { name: IconName; size?: "sm" | "lg" }) {
  return (
    <svg
      aria-hidden="true"
      className={size === undefined ? "i" : `i ${size}`}
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
      viewBox="0 0 24 24"
    />
  );
}

/** The Crewstead arch mark. It takes the colour of the surrounding text. */
export function Logo() {
  return (
    <svg aria-hidden="true" viewBox="152 138 485 467">
      <g fill="currentColor">
        <path d="M152 605V413A275 275 0 0 1 427 138V238A175 175 0 0 0 252 413V605Z" />
        <path d="M438 229A199 199 0 0 1 637 428V605H538V428A100 100 0 0 0 438 328Z" />
        <path d="M305 605V444A122 122 0 0 1 427 322V605Z" />
      </g>
    </svg>
  );
}
