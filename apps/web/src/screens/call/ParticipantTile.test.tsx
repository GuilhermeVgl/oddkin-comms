// @vitest-environment happy-dom
import { render } from "@testing-library/react";
import { Track, type Participant } from "livekit-client";
import { describe, expect, it, vi } from "vitest";
import { ParticipantTile } from "./ParticipantTile";

describe("ParticipantTile audio", () => {
  it("attaches a remote microphone track to an autoplaying audio element", () => {
    const attach = vi.fn();
    const detach = vi.fn();
    const microphone = {
      isMuted: false,
      track: { attach, detach },
    };
    const participant = {
      identity: "ana@example.test",
      name: "Ana",
      isLocal: false,
      isSpeaking: false,
      on: vi.fn(),
      off: vi.fn(),
      getTrackPublication: vi.fn((source: Track.Source) =>
        source === Track.Source.Microphone ? microphone : undefined,
      ),
    } as unknown as Participant;

    const { container, unmount } = render(
      <ParticipantTile
        external={false}
        participant={participant}
        shared={false}
      />,
    );

    const audio = container.querySelector("audio");
    expect(audio?.autoplay).toBe(true);
    expect(attach).toHaveBeenCalledWith(audio);
    unmount();
    expect(detach).toHaveBeenCalledWith(audio);
  });
});
