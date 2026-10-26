import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type CSSProperties,
} from "react";
import {
  H,
  W,
  mountSprite,
  type PoseName,
  type SpriteHandle,
  type Who,
} from "./sprites";
import { useDuoVisible } from "./duoVisibility";

const LABELS: Record<Who, string> = {
  capuz: "Capuz, personagem pixel de capuz verde",
  tela: "Tela, personagem pixel de cabeça de TV",
};

export type SpriteRef = { set(pose: PoseName, hold?: number): void };

/** One Pixel Explorer, drawn on a canvas and animated by the shared ticker. */
export const Sprite = forwardRef<
  SpriteRef,
  { who: Who; scale?: number; pose?: PoseName; label?: string }
>(function Sprite({ who, scale = 4, pose = "idle", label }, ref) {
  const visible = useDuoVisible();
  const canvas = useRef<HTMLCanvasElement>(null);
  const handle = useRef<SpriteHandle | null>(null);

  useEffect(() => {
    if (!visible || canvas.current === null) return;
    const mounted = mountSprite(canvas.current, { who, scale, pose });
    handle.current = mounted;
    return () => {
      mounted.dispose();
      handle.current = null;
    };
  }, [who, scale, pose, visible]);

  useImperativeHandle(ref, () => ({
    set: (next, hold) => handle.current?.set(next, hold),
  }));

  const style: CSSProperties = { width: W * scale, height: H * scale };
  return visible ? (
    <canvas
      aria-label={label ?? LABELS[who]}
      className={`sprite sprite-${who}`}
      ref={canvas}
      role="img"
      style={style}
    />
  ) : null;
});

export type DuoRef = { set(pose: PoseName, hold?: number): void };

/** Tela and Capuz side by side, always in the same pose. */
export const Duo = forwardRef<
  DuoRef,
  { scale?: number; gap?: number; pose?: PoseName }
>(function Duo({ scale = 4, gap = 0, pose = "idle" }, ref) {
  const visible = useDuoVisible();
  const tela = useRef<SpriteRef>(null);
  const capuz = useRef<SpriteRef>(null);
  useImperativeHandle(ref, () => ({
    set: (next, hold) => {
      tela.current?.set(next, hold);
      capuz.current?.set(next, hold);
    },
  }));
  return visible ? (
    <div
      className="duo"
      style={{
        display: "inline-flex",
        alignItems: "flex-end",
        gap,
        position: "relative",
      }}
    >
      <Sprite pose={pose} ref={tela} scale={scale} who="tela" />
      <Sprite pose={pose} ref={capuz} scale={scale} who="capuz" />
    </div>
  ) : null;
});
