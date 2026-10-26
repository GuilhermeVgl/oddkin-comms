import { Track, type Participant } from "livekit-client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../../design/icons";
import { nameOf } from "../../design/people";
import { tileLabel } from "./callView";

const REFRESH_EVENTS = [
  "trackPublished",
  "trackSubscribed",
  "trackUnsubscribed",
  "trackMuted",
  "trackUnmuted",
  "localTrackPublished",
  "localTrackUnpublished",
] as const;

/** Re-renders when the participant speaks or their tracks change. */
function useParticipantActivity(participant: Participant) {
  const [speaking, setSpeaking] = useState(participant.isSpeaking);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const refresh = () => setVersion((value) => value + 1);
    participant.on("isSpeakingChanged", setSpeaking);
    for (const name of REFRESH_EVENTS) participant.on(name, refresh);
    return () => {
      participant.off("isSpeakingChanged", setSpeaking);
      for (const name of REFRESH_EVENTS) participant.off(name, refresh);
    };
  }, [participant]);
  return { speaking, version };
}

/** One person on the stage: their video (or initial), name and microphone state. */
export function ParticipantTile({
  participant,
  shared,
  external,
}: {
  participant: Participant;
  shared: boolean;
  external: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const { speaking, version } = useParticipantActivity(participant);

  useEffect(() => {
    const element = video.current;
    const screen = participant.getTrackPublication(
      Track.Source.ScreenShare,
    )?.track;
    const camera = participant.getTrackPublication(Track.Source.Camera)?.track;
    const track = shared ? (screen ?? camera) : (camera ?? screen);
    if (element === null || track === undefined) return undefined;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [participant, version, shared]);

  const microphone = participant.getTrackPublication(Track.Source.Microphone);
  const muted = microphone === undefined || microphone.isMuted;
  const hasVideo =
    participant.getTrackPublication(Track.Source.Camera)?.track !== undefined ||
    participant.getTrackPublication(Track.Source.ScreenShare)?.track !==
      undefined;
  const name = participant.name ?? participant.identity;
  const lit = speaking && !muted;
  return (
    <div
      aria-label={tileLabel(name, { muted, speaking: lit })}
      className={`tile${lit ? " speaking" : ""}${shared ? " shared" : ""}`}
    >
      <video
        autoPlay
        className={`fill-video${shared ? " contain" : ""}${hasVideo ? "" : " is-off"}`}
        muted={participant.isLocal}
        playsInline
        ref={video}
      />
      {hasVideo ? null : (
        <span className="av xl tile-avatar" data-c={(name.length % 6) + 1}>
          {nameOf(name).charAt(0)}
        </span>
      )}
      <div className="nm">
        {lit ? (
          <span aria-hidden="true" className="eqz">
            <i />
            <i />
            <i />
          </span>
        ) : null}
        {nameOf(name)}
        {shared ? " · tela" : ""}
        {external ? <span className="ext">externo</span> : null}
        {participant.isLocal ? " (você)" : ""}
      </div>
      {muted ? (
        <span aria-label="Microfone desligado" className="tag mute" role="img">
          <Icon name="micOff" size="sm" />
        </span>
      ) : null}
    </div>
  );
}
