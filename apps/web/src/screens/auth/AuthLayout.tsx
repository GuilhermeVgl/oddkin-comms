import type { ReactNode } from "react";
import { APP_NAME } from "../../brand";
import { Logo } from "../../design/icons";

/** The two-column page every sign-in step shares: art on the left, the step on the right. */
export function AuthLayout({
  art,
  children,
  overlay,
}: {
  art: ReactNode;
  children: ReactNode;
  /** Dialogs opened from the page, rendered after it inside the app root. */
  overlay?: ReactNode;
}) {
  return (
    <div id="app">
      <div className="login">
        {art}
        <section className="login-form">{children}</section>
      </div>
      {overlay}
    </div>
  );
}

/** The dark art panel: brand mark, an optional scene and the headline. */
export function ArtPanel({
  headline,
  children,
  ariaHidden,
}: {
  headline: ReactNode;
  children?: ReactNode;
  /** Set to false to say explicitly that the panel is not hidden from assistive tech. */
  ariaHidden?: false;
}) {
  return (
    <section aria-hidden={ariaHidden} className="login-art">
      <div className="brand">
        <Logo />
        <span>{APP_NAME}</span>
      </div>
      {children}
      <h2>{headline}</h2>
    </section>
  );
}

/** Pixel mascots standing on the floor strip. */
export function ArtStage({
  children,
  start = false,
  rise = false,
}: {
  children: ReactNode;
  /** Align the mascots to the left instead of centering them. */
  start?: boolean;
  /** Slide the scene in (callers pass false when motion is reduced). */
  rise?: boolean;
}) {
  return (
    <div className={`stage-px${start ? " start" : ""}${rise ? " rise" : ""}`}>
      <div className="floor" />
      {children}
    </div>
  );
}
