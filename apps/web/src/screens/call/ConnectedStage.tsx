import type { Call } from "@crewstead/api-client";
import { Track, type Participant } from "livekit-client";
import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "../../design/icons";
import { Banner } from "../../design/primitives";
import {
  participantsCount,
  rotationNotice,
  stageLayout,
  type StageFocus,
} from "./callView";
import { CallClock } from "./CallClock";
import { CallControls } from "./CallControls";
import { ParticipantTile } from "./ParticipantTile";

type ControlsProps = Omit<
  Parameters<typeof CallControls>[0],
  | "chatAvailable"
  | "chatOpen"
  | "shareFocus"
  | "sharedScreenActive"
  | "onToggleChat"
  | "onToggleShareFocus"
>;

function CallHeader({
  title,
  call,
  count,
  since,
}: {
  title: string;
  call: Call | null;
  count: number;
  since: number;
}) {
  return (
    <div className="sh">
      <h2>{title}</h2>
      <span
        aria-label={`Criptografia ponta a ponta, chave versão ${call?.keyGeneration ?? 1}`}
        className="lock"
        title="Chave de mídia efêmera, distribuída em envelopes para os dispositivos admitidos"
      >
        <Icon name="lock" size="sm" />
        <span className="call-wide">
          E2EE · chave v{call?.keyGeneration ?? 1}
        </span>
        <span aria-hidden="true" className="call-compact">
          E2EE
        </span>
      </span>
      <span className="grow" />
      <span
        aria-label={participantsCount(count, call?.maxParticipants)}
        className="tag mute num count"
      >
        <span className="call-wide">
          {participantsCount(count, call?.maxParticipants)}
        </span>
        <span aria-hidden="true" className="call-compact">
          {count}/{call?.maxParticipants ?? 5}
        </span>
      </span>
      <CallClock since={since} />
    </div>
  );
}

/** The call itself: header, key rotation notice, tiles, controls and any error. */
export function ConnectedStage({
  title,
  call,
  participants,
  since,
  message,
  isExternal,
  controls,
  chat,
}: {
  title: string;
  call: Call | null;
  participants: readonly Participant[];
  since: number;
  message: string;
  isExternal: (identity: string) => boolean;
  controls: ControlsProps;
  chat: ReactNode | null;
}) {
  const count = participants.length;
  const [chatOpen, setChatOpen] = useState(false);
  const [shareFocus, setShareFocus] = useState<StageFocus>("screen");
  const sharer = participants.find(
    (participant) =>
      participant.getTrackPublication(Track.Source.ScreenShare)?.track !==
      undefined,
  );
  const layout = stageLayout(participants, sharer, shareFocus);
  useEffect(() => {
    if (sharer === undefined) setShareFocus("screen");
  }, [sharer]);

  const tile = (
    entry: (typeof layout.main)[number],
    place: "main" | "rail",
  ) => (
    <ParticipantTile
      external={isExternal(entry.participant.identity)}
      key={`${place}-${entry.kind}-${entry.participant.identity}`}
      participant={entry.participant}
      source={entry.kind}
    />
  );
  return (
    <>
      <CallHeader call={call} count={count} since={since} title={title} />
      <div className={`call-body${chatOpen ? " with-chat" : ""}`}>
        <main className="call-visual">
          {call !== null && call.keyState !== "ok" ? (
            <div className="keyrot toast" role="status">
              <Icon name="rot" />
              <span>{rotationNotice(call)}</span>
            </div>
          ) : null}
          <div
            className={`call-layout${layout.rail.length > 0 ? " has-rail" : ""}`}
          >
            <div
              aria-label="Participantes em evidência"
              aria-live="polite"
              className="tiles"
              data-n={Math.min(layout.main.length, 5)}
            >
              {layout.main.map((entry) => tile(entry, "main"))}
            </div>
            {layout.rail.length === 0 ? null : (
              <div aria-label="Outras mídias" className="call-rail">
                {layout.rail.map((entry) => tile(entry, "rail"))}
              </div>
            )}
          </div>
        </main>
        {chatOpen && chat !== null ? (
          <aside aria-label={`Chat de ${title}`} className="call-chat">
            <header>
              <div>
                <strong>Chat</strong>
                <span>{title}</span>
              </div>
              <button
                aria-label="Ocultar chat"
                className="iconbtn"
                onClick={() => setChatOpen(false)}
                type="button"
              >
                <Icon name="x" />
              </button>
            </header>
            {chat}
          </aside>
        ) : null}
      </div>
      <CallControls
        {...controls}
        chatAvailable={chat !== null}
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen((value) => !value)}
        onToggleShareFocus={() =>
          setShareFocus((value) => (value === "screen" ? "people" : "screen"))
        }
        shareFocus={shareFocus}
        sharedScreenActive={sharer !== undefined}
      />
      {message === "" ? null : (
        <Banner kind="err" role="alert" style={{ margin: "0 20px 16px" }}>
          {message}
        </Banner>
      )}
    </>
  );
}
