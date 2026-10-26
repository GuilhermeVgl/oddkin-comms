import { getPrefs } from "./prefs";

export type BlipKind = "ok" | "win" | "err";

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

let context: AudioContext | null = null;

const SEQUENCES: Record<BlipKind, [number, number][]> = {
  win: [
    [523, 0],
    [659, 90],
    [784, 180],
    [1047, 270],
  ],
  err: [
    [220, 0],
    [165, 110],
  ],
  ok: [
    [660, 0],
    [880, 80],
  ],
};

/** Tiny square-wave blips. Silent unless the person turned sound on. */
export function blip(kind: BlipKind = "ok") {
  if (!getPrefs().sound) return;
  try {
    const Context =
      window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
    if (Context === undefined) return;
    context ??= new Context();
    const audio = context;
    for (const [frequency, offset] of SEQUENCES[kind]) {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = "square";
      oscillator.frequency.value = frequency;
      gain.gain.value = 0.04;
      oscillator.connect(gain);
      gain.connect(audio.destination);
      const start = audio.currentTime + offset / 1000;
      oscillator.start(start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
      oscillator.stop(start + 0.15);
    }
  } catch {
    // Audio is a nicety; a blocked context must never break a flow.
  }
}

/**
 * A phone ring (two overlapping tones, twice, then a pause) that repeats until
 * the returned function is called. An incoming call rings even when the other
 * interface sounds are off; the browser may still keep it silent until the
 * person has interacted with the page.
 */
export function startRing(): () => void {
  let timer: number | undefined;
  const burst = () => {
    try {
      const Context =
        window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
      if (Context === undefined) return;
      context ??= new Context();
      const audio = context;
      if (audio.state === "suspended") void audio.resume();
      for (const offset of [0, 0.55]) {
        for (const frequency of [440, 480]) {
          const oscillator = audio.createOscillator();
          const gain = audio.createGain();
          oscillator.type = "sine";
          oscillator.frequency.value = frequency;
          const start = audio.currentTime + offset;
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(0.08, start + 0.03);
          gain.gain.setValueAtTime(0.08, start + 0.4);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
          oscillator.connect(gain);
          gain.connect(audio.destination);
          oscillator.start(start);
          oscillator.stop(start + 0.5);
        }
      }
    } catch {
      // Audio is a nicety; a blocked context must never break a flow.
    }
  };
  burst();
  timer = window.setInterval(burst, 3000);
  return () => {
    if (timer !== undefined) window.clearInterval(timer);
    timer = undefined;
  };
}
