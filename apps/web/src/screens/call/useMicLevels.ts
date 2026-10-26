import { useEffect, useState } from "react";
import { levelsFromSpectrum, restingLevels } from "./media";

/** A level meter for the microphone preview, drawn from the real audio. */
export function useMicLevels(stream: MediaStream | null, bars: number) {
  const [levels, setLevels] = useState<number[]>(() => restingLevels(bars));
  useEffect(() => {
    if (stream === null || stream.getAudioTracks().length === 0) {
      setLevels(restingLevels(bars));
      return undefined;
    }
    let frame = 0;
    let context: AudioContext | null = null;
    try {
      context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 64;
      context.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteFrequencyData(data);
        setLevels(levelsFromSpectrum(data, bars));
        frame = requestAnimationFrame(loop);
      };
      loop();
    } catch {
      // Without Web Audio the meter just stays low.
    }
    return () => {
      cancelAnimationFrame(frame);
      void context?.close();
    };
  }, [stream, bars]);
  return levels;
}
