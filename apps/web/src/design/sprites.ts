/*
 * ODDKIN Pixel Explorers: procedural sprite engine (Capuz and Tela) and pixel
 * particles. 32x40 logical pixels per character, scaled by whole numbers with
 * no smoothing. Ported from the approved interactive prototype.
 */
import { isReduced, onMotionChange } from "./prefs";

export const W = 32;
export const H = 40;

export type Who = "capuz" | "tela";
type Eyes = "open" | "side" | "blink" | "closed" | "happy" | "x" | "dots";
type Legs = "stand" | "w0" | "w1" | "sit" | "jump";
type Point = [number, number];

export type PoseName =
  | "idle"
  | "wave"
  | "walk"
  | "think"
  | "cheer"
  | "highfive"
  | "sit"
  | "sleep"
  | "oops"
  | "load";

type Pose = {
  bob?: number;
  blink?: boolean;
  shake?: number;
  lean?: number;
  eyes?: Eyes;
  dot?: number;
  lh: Point;
  rh: Point;
  legs: Legs;
};

const C: Record<string, string> = {
  ol: "#0b0d0c",
  hood: "#6b7f5e",
  hoodM: "#55674c",
  hoodD: "#3b4836",
  hoodL: "#889d72",
  voidc: "#090b0a",
  eye: "#e6ff55",
  eyeD: "#8fa82a",
  lime: "#dfff70",
  limeD: "#a5c437",
  pack: "#8d6c46",
  packD: "#624b30",
  packL: "#ab8658",
  glove: "#6b543a",
  gloveL: "#876b4b",
  pants: "#181b1a",
  boot: "#2b2e2f",
  sole: "#8f7852",
  soleD: "#6b5a3c",
  bot: "#363a3d",
  botM: "#282b2d",
  botL: "#4d5256",
  botD: "#1c1e1f",
  frame: "#a39270",
  frameD: "#776a4a",
  screen: "#0a0c0b",
  white: "#f1f0e8",
};

class Buf {
  p: (string | undefined)[] = new Array<string | undefined>(W * H);

  set(x: number, y: number, c: string | undefined) {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= W || py >= H) return;
    this.p[py * W + px] = c;
  }

  rect(x: number, y: number, w: number, h: number, c: string) {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }

  ell(cx: number, cy: number, rx: number, ry: number, c: string) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, c);
      }
    }
  }

  poly(pts: Point[], c: string) {
    let minY = 1e9;
    let maxY = -1e9;
    for (const [, y] of pts) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const sy = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % pts.length]!;
        if ((a[1] <= sy && b[1] > sy) || (b[1] <= sy && a[1] > sy)) {
          xs.push(a[0] + ((sy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
      xs.sort((m, n) => m - n);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        for (let x = Math.round(xs[i]!); x < Math.round(xs[i + 1]!); x++)
          this.set(x, y, c);
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, c: string, t = 1) {
    let cx = Math.round(x0);
    let cy = Math.round(y0);
    const ex = Math.round(x1);
    const ey = Math.round(y1);
    const dx = Math.abs(ex - cx);
    const dy = -Math.abs(ey - cy);
    const sx = cx < ex ? 1 : -1;
    const sy = cy < ey ? 1 : -1;
    let err = dx + dy;
    const o = Math.floor(t / 2);
    for (;;) {
      this.rect(cx - o, cy - o, t, t, c);
      if (cx === ex && cy === ey) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        cx += sx;
      }
      if (e2 <= dx) {
        err += dx;
        cy += sy;
      }
    }
  }

  outline(oc: string) {
    const src = this.p.slice();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (src[y * W + x] !== undefined) continue;
        if (
          (x > 0 && src[y * W + x - 1]) ||
          (x < W - 1 && src[y * W + x + 1]) ||
          (y > 0 && src[(y - 1) * W + x]) ||
          (y < H - 1 && src[(y + 1) * W + x])
        ) {
          this.p[y * W + x] = oc;
        }
      }
    }
  }

  /** Pixels of `base` with an empty pixel above get the light shade. */
  edge(base: string, light: string) {
    const src = this.p.slice();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (src[y * W + x] !== base) continue;
        const up = y > 0 ? src[(y - 1) * W + x] : undefined;
        if (!up) this.p[y * W + x] = light;
      }
    }
  }
}

const POSES: Record<PoseName, (t: number, who: Who) => Pose> = {
  idle: (t) => ({
    bob: t % 8 < 4 ? 0 : 1,
    blink: t % 28 === 0 || t % 28 === 1,
    lh: [7, 29],
    rh: [25, 29],
    legs: "stand",
  }),
  wave: (t, who) => {
    const f = t % 4 < 2;
    const up: Point = f ? [27, 10] : [29, 11];
    const upL: Point = f ? [5, 10] : [3, 11];
    return who === "capuz"
      ? { bob: f ? 0 : 1, blink: false, lh: upL, rh: [25, 29], legs: "stand" }
      : { bob: f ? 0 : 1, blink: false, lh: [7, 29], rh: up, legs: "stand" };
  },
  walk: (t) => {
    const k = t % 4;
    return {
      bob: k % 2,
      blink: false,
      lh: k < 2 ? [9, 28] : [6, 29],
      rh: k < 2 ? [23, 29] : [26, 28],
      legs: k < 2 ? "w0" : "w1",
    };
  },
  think: (t, who) => {
    const pose: Pose = {
      bob: t % 10 < 5 ? 0 : 1,
      blink: t % 20 === 0,
      lh: [9, 29],
      rh: [20, 18],
      legs: "stand",
      eyes: t % 12 < 6 ? "open" : "side",
    };
    if (who === "capuz") {
      pose.lh = [12, 17];
      pose.rh = [25, 29];
    }
    return pose;
  },
  cheer: (t) => {
    const f = t % 4 < 2;
    return {
      bob: f ? 0 : -2,
      blink: false,
      eyes: "happy",
      lh: f ? [5, 8] : [4, 10],
      rh: f ? [27, 8] : [28, 10],
      legs: f ? "stand" : "jump",
    };
  },
  highfive: (t, who) => {
    const f = t % 6 < 3;
    return who === "capuz"
      ? {
          bob: 0,
          blink: false,
          eyes: "happy",
          lh: f ? [3, 17] : [2, 16],
          rh: [25, 29],
          legs: "stand",
          lean: -1,
        }
      : {
          bob: 0,
          blink: false,
          eyes: "happy",
          lh: [7, 29],
          rh: f ? [29, 17] : [30, 16],
          legs: "stand",
          lean: 1,
        };
  },
  sit: (t) => ({
    bob: 0,
    blink: t % 30 === 0,
    lh: [8, 33],
    rh: [24, 33],
    legs: "sit",
  }),
  sleep: (t) => ({
    bob: t % 12 < 6 ? 0 : 1,
    blink: false,
    eyes: "closed",
    lh: [8, 33],
    rh: [24, 33],
    legs: "sit",
  }),
  oops: (t) => ({
    bob: 0,
    shake: t % 2 ? 1 : -1,
    blink: false,
    eyes: "x",
    lh: [6, 18],
    rh: [26, 18],
    legs: "stand",
  }),
  load: (t) => ({
    bob: t % 6 < 3 ? 0 : 1,
    blink: false,
    eyes: "dots",
    dot: t % 4,
    lh: [7, 29],
    rh: [25, 29],
    legs: "stand",
  }),
};

function eyeMode(pose: Pose): Eyes {
  return pose.eyes ?? (pose.blink ? "blink" : "open");
}

function crossEyes(b: Buf, y: number) {
  for (const x of [12, 18]) {
    b.set(x, y, "eye");
    b.set(x + 2, y, "eye");
    b.set(x + 1, y + 1, "eye");
    b.set(x, y + 2, "eye");
    b.set(x + 2, y + 2, "eye");
  }
}

function happyEyes(b: Buf, y: number) {
  for (const x of [12, 18]) {
    b.set(x, y + 2, "eye");
    b.set(x + 1, y + 1, "eye");
    b.set(x + 2, y + 2, "eye");
  }
}

function eyesCapuz(b: Buf, bob: number, pose: Pose) {
  const y = 11 + bob;
  const e = eyeMode(pose);
  const dot = pose.dot ?? 0;
  if (e === "open") {
    b.rect(13, y, 1, 3, "eye");
    b.rect(19, y, 1, 3, "eye");
  } else if (e === "side") {
    b.rect(14, y, 1, 3, "eye");
    b.rect(20, y, 1, 3, "eye");
  } else if (e === "blink" || e === "closed") {
    b.rect(12, y + 2, 3, 1, "eyeD");
    b.rect(18, y + 2, 3, 1, "eyeD");
  } else if (e === "happy") happyEyes(b, y);
  else if (e === "x") crossEyes(b, y);
  else if (e === "dots") {
    b.set(12, y + 1, "eye");
    b.set(13, y + 1, dot > 0 ? "eye" : "eyeD");
    b.set(15, y + 1, dot > 1 ? "eye" : "eyeD");
    b.set(17, y + 1, dot > 2 ? "eye" : "eyeD");
  }
}

function capuz(pose: Pose): Buf {
  const b = new Buf();
  const bob = pose.bob ?? 0;
  const sx = pose.shake ?? 0;
  const lean = pose.lean ?? 0;
  const sit = pose.legs === "sit";
  const jump = pose.legs === "jump";
  const oy = (sit ? 6 : 0) + bob;
  const ox = sx + lean;
  // backpack (behind)
  b.rect(21 + ox, 17 + oy, 7, 11, "pack");
  b.rect(21 + ox, 17 + oy, 7, 1, "packL");
  b.rect(26 + ox, 18 + oy, 2, 10, "packD");
  b.rect(21 + ox, 27 + oy, 7, 1, "packD");
  b.ell(24.5 + ox, 16.5 + oy, 3.4, 2.2, "packL");
  b.set(24 + ox, 16 + oy, "packD");
  b.set(25 + ox, 16 + oy, "packD");
  b.rect(26 + ox, 29 + oy, 1, 1, "lime");
  b.rect(26 + ox, 30 + oy, 1, 2, "limeD");
  b.set(26 + ox, 32 + oy, "lime");
  // legs
  const ly = 31 + oy;
  if (sit) {
    b.rect(10 + ox, 35, 13, 3, "pants");
    b.rect(21 + ox, 34, 6, 4, "boot");
    b.rect(21 + ox, 37, 6, 1, "sole");
    b.rect(23 + ox, 35, 3, 1, "lime");
  } else {
    let l0 = 0;
    let l1 = 0;
    let lx0 = 0;
    let lx1 = 0;
    if (pose.legs === "w0") {
      lx0 = -2;
      lx1 = 2;
      l1 = -2;
    }
    if (pose.legs === "w1") {
      lx0 = 2;
      l0 = -2;
      lx1 = -2;
    }
    if (jump) {
      l0 = -3;
      l1 = -3;
    }
    b.rect(11 + ox, ly, 3, Math.max(1, 35 + l0 - ly + 1), "pants");
    b.rect(19 + ox, ly, 3, Math.max(1, 35 + l1 - ly + 1), "pants");
    b.rect(9 + lx0 + ox, 35 + l0, 6, 3, "boot");
    b.rect(9 + lx0 + ox, 37 + l0, 6, 1, "sole");
    b.rect(10 + lx0 + ox, 36 + l0, 4, 1, "lime");
    b.rect(18 + lx1 + ox, 35 + l1, 6, 3, "boot");
    b.rect(18 + lx1 + ox, 37 + l1, 6, 1, "sole");
    b.rect(19 + lx1 + ox, 36 + l1, 4, 1, "lime");
  }
  // torso (jacket)
  b.poly(
    [
      [9 + ox, 18 + oy],
      [23 + ox, 18 + oy],
      [25 + ox, 31 + oy],
      [7 + ox, 31 + oy],
    ],
    "hood",
  );
  b.rect(20 + ox, 20 + oy, 4, 11, "hoodM");
  b.rect(8 + ox, 30 + oy, 17, 1, "hoodM");
  for (let i = 0; i < 5; i++) b.set(16 + ox, 22 + oy + i * 2, "lime");
  b.line(10 + ox, 21 + oy, 12 + ox, 24 + oy, "lime", 1);
  b.line(22 + ox, 21 + oy, 21 + ox, 23 + oy, "limeD", 1);
  // arms
  const shL: Point = [9 + ox, 20 + oy];
  const shR: Point = [23 + ox, 20 + oy];
  const lh: Point = [
    pose.lh[0] + ox,
    pose.lh[1] + (pose.lh[1] > 24 ? oy : bob),
  ];
  const rh: Point = [
    pose.rh[0] + ox,
    pose.rh[1] + (pose.rh[1] > 24 ? oy : bob),
  ];
  b.line(shL[0], shL[1], lh[0], lh[1], "hoodM", 4);
  b.line(shL[0], shL[1] - 1, lh[0], lh[1] - 1, "hood", 2);
  b.line(shR[0], shR[1], rh[0], rh[1], "hoodM", 4);
  b.line(shR[0], shR[1] - 1, rh[0], rh[1] - 1, "hood", 2);
  b.rect(lh[0] - 1, lh[1] - 1, 4, 4, "glove");
  b.rect(lh[0] - 1, lh[1] - 1, 4, 1, "gloveL");
  b.rect(rh[0] - 1, rh[1] - 1, 4, 4, "glove");
  b.rect(rh[0] - 1, rh[1] - 1, 4, 1, "gloveL");
  b.set(shL[0] - 1, shL[1] + 3, "lime");
  b.set(shR[0] + 1, shR[1] + 3, "lime");
  // hood
  b.ell(16 + ox, 10 + oy, 11, 9, "hood");
  b.ell(17 + ox, 4.5 + oy, 5.5, 3.8, "hood");
  b.rect(8 + ox, 17 + oy, 17, 3, "hood");
  b.ell(19 + ox, 14 + oy, 7, 6, "hoodM");
  b.ell(15 + ox, 9 + oy, 9.3, 7.8, "hood");
  b.edge("hood", "hoodL");
  // face opening
  b.poly(
    [
      [16 + ox, 4 + oy],
      [23 + ox, 10 + oy],
      [22 + ox, 17 + oy],
      [10 + ox, 17 + oy],
      [9 + ox, 10 + oy],
    ],
    "hoodD",
  );
  b.poly(
    [
      [16 + ox, 5 + oy],
      [22 + ox, 10 + oy],
      [21 + ox, 17 + oy],
      [11 + ox, 17 + oy],
      [10 + ox, 10 + oy],
    ],
    "voidc",
  );
  eyesCapuz(b, oy, pose);
  b.outline("ol");
  return b;
}

function eyesTela(b: Buf, oy: number, pose: Pose) {
  const y = 13 + oy;
  const e = eyeMode(pose);
  const dot = pose.dot ?? 0;
  if (e === "open") {
    b.rect(13, y, 2, 3, "eye");
    b.rect(18, y, 2, 3, "eye");
  } else if (e === "side") {
    b.rect(14, y, 2, 3, "eye");
    b.rect(19, y, 2, 3, "eye");
  } else if (e === "blink" || e === "closed") {
    b.rect(12, y + 2, 3, 1, "eyeD");
    b.rect(18, y + 2, 3, 1, "eyeD");
  } else if (e === "happy") happyEyes(b, y);
  else if (e === "x") crossEyes(b, y);
  else if (e === "dots") {
    b.rect(12, y + 1, 2, 2, "eye");
    b.rect(15, y + 1, 2, 2, dot > 1 ? "eye" : "eyeD");
    b.rect(18, y + 1, 2, 2, dot > 2 ? "eye" : "eyeD");
  }
}

function clampHand(sh: Point, h: Point): Point {
  const dx = h[0] - sh[0];
  const dy = h[1] - sh[1];
  const d = Math.sqrt(dx * dx + dy * dy);
  const m = 11;
  if (d > m)
    return [Math.round(sh[0] + (dx / d) * m), Math.round(sh[1] + (dy / d) * m)];
  return h;
}

function tela(pose: Pose): Buf {
  const b = new Buf();
  const bob = pose.bob ?? 0;
  const sx = pose.shake ?? 0;
  const lean = pose.lean ?? 0;
  const sit = pose.legs === "sit";
  const jump = pose.legs === "jump";
  const oy = (sit ? 5 : 0) + bob + 2;
  const ox = sx + lean;
  // backpack
  b.rect(5 + ox, 23 + oy, 5, 8, "botL");
  b.rect(5 + ox, 30 + oy, 5, 1, "botD");
  b.rect(6 + ox, 25 + oy, 1, 4, "lime");
  // legs
  const ly = 32 + oy;
  if (sit) {
    b.rect(11 + ox, 36, 11, 2, "botM");
    b.rect(21 + ox, 35, 5, 3, "glove");
    b.rect(22 + ox, 36, 3, 1, "lime");
  } else {
    let l0 = 0;
    let l1 = 0;
    let lx0 = 0;
    let lx1 = 0;
    if (pose.legs === "w0") {
      lx0 = -2;
      lx1 = 2;
      l1 = -1;
    }
    if (pose.legs === "w1") {
      lx0 = 2;
      lx1 = -2;
      l0 = -1;
    }
    if (jump) {
      l0 = -2;
      l1 = -2;
    }
    b.rect(12 + ox, ly, 3, Math.max(1, 35 + l0 - ly + 1), "botM");
    b.rect(18 + ox, ly, 3, Math.max(1, 35 + l1 - ly + 1), "botM");
    b.rect(10 + lx0 + ox, 35 + l0, 6, 3, "glove");
    b.rect(10 + lx0 + ox, 37 + l0, 6, 1, "soleD");
    b.rect(11 + lx0 + ox, 36 + l0, 4, 1, "lime");
    b.rect(17 + lx1 + ox, 35 + l1, 6, 3, "glove");
    b.rect(17 + lx1 + ox, 37 + l1, 6, 1, "soleD");
    b.rect(18 + lx1 + ox, 36 + l1, 4, 1, "lime");
  }
  // torso
  b.rect(10 + ox, 22 + oy, 13, 10, "bot");
  b.rect(10 + ox, 22 + oy, 13, 1, "botL");
  b.rect(21 + ox, 23 + oy, 2, 9, "botM");
  b.rect(10 + ox, 31 + oy, 13, 1, "botM");
  b.line(11 + ox, 23 + oy, 13 + ox, 26 + oy, "lime", 1);
  b.line(21 + ox, 23 + oy, 19 + ox, 26 + oy, "limeD", 1);
  b.rect(15 + ox, 28 + oy, 3, 2, "botD");
  b.set(16 + ox, 28 + oy, "lime");
  // arms (thinner and shorter than Capuz: the reach is clamped)
  const shL: Point = [10 + ox, 24 + oy];
  const shR: Point = [23 + ox, 24 + oy];
  const lh = clampHand(shL, [
    pose.lh[0] + ox,
    pose.lh[1] + (pose.lh[1] > 24 ? oy - 2 : bob + 2),
  ]);
  const rh = clampHand(shR, [
    pose.rh[0] + ox,
    pose.rh[1] + (pose.rh[1] > 24 ? oy - 2 : bob + 2),
  ]);
  b.line(shL[0], shL[1], lh[0], lh[1], "botM", 3);
  b.line(shR[0], shR[1], rh[0], rh[1], "botM", 3);
  b.rect(lh[0] - 1, lh[1] - 1, 4, 4, "glove");
  b.rect(rh[0] - 1, rh[1] - 1, 4, 4, "glove");
  b.rect(lh[0] - 1, lh[1] - 1, 4, 1, "gloveL");
  b.rect(rh[0] - 1, rh[1] - 1, 4, 1, "gloveL");
  // head (a small television)
  b.rect(6 + ox, 6 + oy, 21, 15, "bot");
  b.set(6 + ox, 6 + oy, undefined);
  b.set(26 + ox, 6 + oy, undefined);
  b.set(6 + ox, 20 + oy, undefined);
  b.set(26 + ox, 20 + oy, undefined);
  b.rect(7 + ox, 6 + oy, 19, 1, "botL");
  b.rect(25 + ox, 8 + oy, 2, 12, "botM");
  b.rect(7 + ox, 20 + oy, 19, 1, "botM");
  b.rect(10 + ox, 8 + oy, 14, 11, "frameD");
  b.rect(10 + ox, 8 + oy, 14, 1, "frame");
  b.rect(10 + ox, 8 + oy, 1, 11, "frame");
  b.rect(11 + ox, 9 + oy, 12, 9, "screen");
  // speaker
  b.ell(8.2 + ox, 14 + oy, 1.6, 1.8, "frameD");
  b.set(8 + ox, 13 + oy, "frame");
  eyesTela(b, oy, pose);
  b.outline("ol");
  return b;
}

const DRAW: Record<Who, (pose: Pose) => Buf> = { capuz, tela };

function paint(
  ctx: CanvasRenderingContext2D,
  buf: Buf,
  scale: number,
  flip: boolean,
) {
  ctx.clearRect(0, 0, W * scale, H * scale);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const key = buf.p[y * W + x];
      if (key === undefined) continue;
      ctx.fillStyle = C[key] ?? key;
      const px = flip ? W - 1 - x : x;
      ctx.fillRect(px * scale, y * scale, scale, scale);
    }
  }
}

/* ---------- ticker ---------- */

type Mounted = {
  canvas: HTMLCanvasElement;
  visible: boolean;
  step: (tick: number) => void;
  redraw: () => void;
};

const mounted = new Set<Mounted>();
let timer: number | null = null;
let tick = 0;

function loop() {
  tick++;
  for (const entry of mounted) {
    if (!entry.canvas.isConnected) {
      mounted.delete(entry);
      continue;
    }
    if (entry.visible) entry.step(tick);
  }
}

function start() {
  timer ??= window.setInterval(loop, 130);
}

const observer =
  typeof IntersectionObserver === "function"
    ? new IntersectionObserver((entries) => {
        for (const entry of entries) {
          for (const item of mounted) {
            if (item.canvas === entry.target)
              item.visible = entry.isIntersecting;
          }
        }
      })
    : null;

onMotionChange(() => {
  for (const entry of mounted) entry.redraw();
});

export type SpriteHandle = {
  /** Switches pose; with `hold` (ms) it returns to the base pose afterwards. */
  set(pose: PoseName, hold?: number): void;
  dispose(): void;
};

export function mountSprite(
  canvas: HTMLCanvasElement,
  options: { who: Who; scale: number; pose: PoseName; flip?: boolean },
): SpriteHandle {
  const { who, scale } = options;
  const flip = options.flip === true;
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return { set() {}, dispose() {} };
  ctx.imageSmoothingEnabled = false;
  const offset = Math.floor(Math.random() * 8);
  let pose = options.pose;
  let hold: number | undefined;
  const draw = (t: number) =>
    paint(ctx, DRAW[who](POSES[pose](t, who)), scale, flip);
  const entry: Mounted = {
    canvas,
    visible: true,
    step: (t) => {
      if (!isReduced()) draw(t + offset);
    },
    redraw: () => draw(offset),
  };
  mounted.add(entry);
  observer?.observe(canvas);
  start();
  draw(offset);
  return {
    set(next, ms) {
      pose = next;
      draw(tick + offset);
      if (hold !== undefined) window.clearTimeout(hold);
      if (ms !== undefined) {
        hold = window.setTimeout(() => {
          pose = options.pose;
          draw(tick + offset);
        }, ms);
      }
    },
    dispose() {
      if (hold !== undefined) window.clearTimeout(hold);
      mounted.delete(entry);
      observer?.unobserve(canvas);
    },
  };
}

/* ---------- pixel particles ---------- */

const FX_COLORS = ["#dfff70", "#dfff70", "#f1f0e8", "#63745a", "#a5c437"];

export type BurstOptions = {
  count?: number;
  size?: number;
  power?: number;
  up?: boolean;
  colors?: string[];
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  c: string;
  s: number;
};

/** A short burst of square particles. Returns false when motion is reduced. */
export function burst(
  x: number,
  y: number,
  options: BurstOptions = {},
): boolean {
  if (isReduced()) return false;
  const canvas = document.createElement("canvas");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.cssText =
    "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    canvas.remove();
    return false;
  }
  const count = options.count ?? 36;
  const size = options.size ?? 5;
  const colors = options.colors ?? FX_COLORS;
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const angle = options.up
      ? -Math.PI / 2 + (Math.random() - 0.5) * 2.2
      : Math.random() * Math.PI * 2;
    const speed = (options.power ?? 7) * (0.4 + Math.random() * 0.8);
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0,
      max: 26 + Math.random() * 22,
      c: colors[i % colors.length] ?? "#dfff70",
      s: size * (Math.random() < 0.3 ? 2 : 1),
    });
  }
  const frame = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = 0;
    for (const p of particles) {
      p.life++;
      if (p.life > p.max) continue;
      alive++;
      p.vy += 0.38;
      p.vx *= 0.97;
      p.x += p.vx;
      p.y += p.vy;
      ctx.globalAlpha = Math.min(1, (p.max - p.life) / 10);
      ctx.fillStyle = p.c;
      ctx.fillRect(
        Math.round(p.x / size) * size,
        Math.round(p.y / size) * size,
        p.s,
        p.s,
      );
    }
    if (alive > 0) requestAnimationFrame(frame);
    else canvas.remove();
  };
  frame();
  return true;
}
