import { useState, type ReactNode } from "react";
import { avatarUrl, useAvatarVersion } from "./avatars";
import { Icon, type IconName } from "./icons";
import { colorOf, nameOf } from "./people";

export type Presence = "on" | "away" | "off";

export function Avatar({
  id,
  email,
  size,
  presence,
}: {
  id: string;
  email: string;
  size?: "sm" | "lg" | "xl";
  presence?: Presence;
}) {
  const full = nameOf(email);
  const version = useAvatarVersion(id);
  const [broken, setBroken] = useState(false);
  return (
    <span
      className={`av${size === undefined ? "" : ` ${size}`}`}
      data-c={colorOf(id)}
      title={full}
    >
      {version === undefined || broken ? (
        full.charAt(0)
      ) : (
        <img
          alt=""
          decoding="async"
          loading="lazy"
          onError={() => setBroken(true)}
          src={avatarUrl(id, version)}
        />
      )}
      {presence === undefined ? null : (
        <i
          className={`pr${presence === "on" ? "" : ` ${presence}`}`}
          title={
            presence === "on"
              ? "Online"
              : presence === "away"
                ? "Ausente"
                : "Offline"
          }
        />
      )}
    </span>
  );
}

/** Placeholder for an item without an assignee. */
export function NoAvatar({ size }: { size?: "sm" | "lg" }) {
  return (
    <span
      className={`av${size === undefined ? "" : ` ${size}`}`}
      style={{
        background: "transparent",
        border: "1.5px dashed var(--line-strong)",
      }}
      title="Sem responsável"
    >
      <Icon name="user" size="sm" />
    </span>
  );
}

export function Banner({
  kind,
  icon,
  children,
  role,
  style,
}: {
  kind?: "ok" | "warn" | "err";
  icon?: IconName;
  children: ReactNode;
  role?: "alert" | "status";
  style?: React.CSSProperties;
}) {
  const name: IconName =
    icon ??
    (kind === "err" || kind === "warn"
      ? "alert"
      : kind === "ok"
        ? "lock"
        : "info");
  return (
    <div
      className={`banner${kind === undefined ? "" : ` ${kind}`}`}
      role={role}
      style={style}
    >
      <Icon name={name} />
      <div className="grow">{children}</div>
    </div>
  );
}

/** The blocky progress bar. */
export function Pbar({
  total,
  on,
  label,
  stagger,
  block,
}: {
  total: number;
  on: number;
  label?: string;
  stagger?: number;
  block?: number;
}) {
  return (
    <div
      aria-hidden={label === undefined ? true : undefined}
      aria-label={label}
      className="pbar"
      role={label === undefined ? undefined : "img"}
    >
      {Array.from({ length: total }, (_, index) => (
        <i
          className={index < on ? "on" : ""}
          key={index}
          style={{
            ...(stagger === undefined
              ? {}
              : { transitionDelay: `${index * stagger}ms` }),
            ...(block === undefined ? {} : { width: block, height: block }),
          }}
        />
      ))}
    </div>
  );
}

export function Empty({
  title,
  children,
  art,
}: {
  title: string;
  children?: ReactNode;
  art?: ReactNode;
}) {
  return (
    <div className="empty">
      {art === undefined ? null : <div className="emp-sp">{art}</div>}
      <h3>{title}</h3>
      {children === undefined ? null : <p>{children}</p>}
    </div>
  );
}
