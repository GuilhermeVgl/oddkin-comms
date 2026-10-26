import type { Call } from "@crewstead/api-client";
import { Track, type Participant } from "livekit-client";
import { Icon } from "../../design/icons";
import { Banner } from "../../design/primitives";
import {
  orderParticipants,
  participantsCount,
  rotationNotice,
} from "./callView";
import { CallClock } from "./CallClock";
import { CallControls } from "./CallControls";
import { ParticipantTile } from "./ParticipantTile";

type ControlsProps = Parameters<typeof CallControls>[0];

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
        className="lock"
        title="Chave de mídia efêmera, distribuída em envelopes para os dispositivos admitidos"
      >
        <Icon name="lock" size="sm" />
        E2EE · chave v{call?.keyGeneration ?? 1}
      </span>
      <span className="grow" />
      <span className="tag mute num count">
        {participantsCount(count, call?.maxParticipants)}
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
}: {
  title: string;
  call: Call | null;
  participants: readonly Participant[];
  since: number;
  message: string;
  isExternal: (identity: string) => boolean;
  controls: ControlsProps;
}) {
  const count = participants.length;
  const sharer = participants.find(
    (participant) =>
      participant.getTrackPublication(Track.Source.ScreenShare)?.track !==
      undefined,
  );
  return (
    <>
      <CallHeader call={call} count={count} since={since} title={title} />
      {call !== null && call.keyState !== "ok" ? (
        <div className="keyrot toast" role="status">
          <Icon name="rot" />
          <span>{rotationNotice(call)}</span>
        </div>
      ) : null}
      <div
        aria-live="polite"
        className={`tiles${sharer === undefined ? "" : " share"}`}
        data-n={Math.min(count, 5)}
      >
        {orderParticipants(participants, sharer).map((participant) => (
          <ParticipantTile
            external={isExternal(participant.identity)}
            key={participant.identity}
            participant={participant}
            shared={participant === sharer}
          />
        ))}
      </div>
      <CallControls {...controls} />
      {message === "" ? null : (
        <Banner kind="err" role="alert" style={{ margin: "0 20px 16px" }}>
          {message}
        </Banner>
      )}
    </>
  );
}
