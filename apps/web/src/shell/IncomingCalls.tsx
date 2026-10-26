import type { CallInvitation } from "@crewstead/api-client";
import { useEffect, useMemo, useState } from "react";
import { nameOf } from "../design/people";
import { Avatar } from "../design/primitives";
import { Icon } from "../design/icons";
import { startRing } from "../design/sound";
import { isRinging } from "./ringing";

/**
 * Incoming calls, like a phone: a card per caller with a pulsing photo, a ring
 * tone and Atender / Recusar, for as long as the invitation is pending.
 */
export function IncomingCalls({
  invitations,
  where,
  busy,
  onAnswer,
  onDecline,
}: {
  invitations: CallInvitation[];
  where: (conversationId: string) => string;
  /** Already in a call: show who is calling, without ringing. */
  busy: boolean;
  onAnswer: (callId: string) => void;
  onDecline: (callId: string) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [muted, setMuted] = useState(false);
  const ringing = useMemo(
    () => invitations.filter((entry) => isRinging(entry, now)),
    [invitations, now],
  );
  const active = ringing.length > 0;

  useEffect(() => {
    if (invitations.length === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [invitations.length]);

  useEffect(() => {
    if (!active || busy || muted) return;
    return startRing();
  }, [active, busy, muted]);

  // A call that arrives while the tab is in the background says so in the title.
  useEffect(() => {
    const first = ringing[0];
    if (first === undefined) return;
    const original = document.title;
    const caller = first.startedBy === "" ? "Alguém" : nameOf(first.startedBy);
    let flash = false;
    const timer = window.setInterval(() => {
      flash = !flash;
      document.title = flash ? `📞 ${caller} está ligando…` : original;
    }, 900);
    return () => {
      window.clearInterval(timer);
      document.title = original;
    };
  }, [ringing]);

  useEffect(() => {
    if (!active) setMuted(false);
  }, [active]);

  if (!active) return null;
  return (
    <div aria-live="assertive" className="ringstack" role="alert">
      {ringing.map((entry) => {
        const caller =
          entry.startedBy === "" ? "Alguém" : nameOf(entry.startedBy);
        return (
          <section
            aria-label={`${caller} está ligando`}
            className="ringcard"
            key={entry.callId}
          >
            <div className="ring-who">
              <span className="ring-av">
                <Avatar
                  email={entry.startedBy || "?"}
                  id={entry.startedById ?? entry.startedBy}
                  size="xl"
                />
              </span>
              <div className="col">
                <b className="ring-name">{caller}</b>
                <span className="xs muted">
                  está ligando · {where(entry.conversationId)}
                </span>
              </div>
              {busy ? null : (
                <button
                  aria-label={muted ? "Ativar o toque" : "Silenciar o toque"}
                  aria-pressed={muted}
                  className="iconbtn"
                  onClick={() => setMuted((value) => !value)}
                  type="button"
                >
                  <Icon name={muted ? "mic" : "bell"} />
                </button>
              )}
            </div>
            <div className="ring-acts">
              <button
                className="btn ring-decline"
                onClick={() => onDecline(entry.callId)}
                type="button"
              >
                <Icon name="x" size="sm" />
                Recusar
              </button>
              <button
                className="btn ring-accept"
                disabled={busy}
                onClick={() => onAnswer(entry.callId)}
                title={busy ? "Saia da chamada atual para atender" : undefined}
                type="button"
              >
                <Icon name="phone" size="sm" />
                Atender
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
