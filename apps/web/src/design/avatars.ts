import { createStore } from "./store";

/** Which people have a photo the signed-in person can see, and its version. */
const store = createStore<{ versions: Record<string, number> }>({
  versions: {},
});

export function setAvatarVersions(
  list: { accountId: string; version: number }[],
) {
  store.set({
    versions: Object.fromEntries(
      list.map((entry) => [entry.accountId, Number(entry.version)]),
    ),
  });
}

export function getAvatarVersions(): Record<string, number> {
  return store.get().versions;
}

export function useAvatarVersion(accountId: string): number | undefined {
  return store.use().versions[accountId];
}

/** The ?v= makes a changed photo load at once instead of waiting for the cache. */
export function avatarUrl(accountId: string, version: number): string {
  return `/api/v1/accounts/${accountId}/avatar?v=${version}`;
}

export const AVATAR_SIZE = 256;
export const MAX_ZOOM = 5;
const MAX_BYTES = 200 * 1024;

/**
 * How a photo sits in the square: turned by quarter turns, zoomed (1 = the
 * whole short side fits), with the middle of the square at a fraction of the
 * turned photo's width and height.
 */
export type Framing = {
  quarterTurns: number;
  zoom: number;
  centerX: number;
  centerY: number;
};

export function initialFraming(): Framing {
  return { quarterTurns: 0, zoom: 1, centerX: 0.5, centerY: 0.5 };
}

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), high);

function turnedSize(width: number, height: number, framing: Framing) {
  return framing.quarterTurns % 2 === 0
    ? { width, height }
    : { width: height, height: width };
}

/** The square, in pixels of the turned photo, that the framing selects. */
export function cropRect(width: number, height: number, framing: Framing) {
  const turned = turnedSize(width, height, framing);
  const side = Math.min(turned.width, turned.height) / framing.zoom;
  return {
    x: clamp(framing.centerX * turned.width - side / 2, 0, turned.width - side),
    y: clamp(
      framing.centerY * turned.height - side / 2,
      0,
      turned.height - side,
    ),
    side,
  };
}

export function zoomFraming(framing: Framing, zoom: number): Framing {
  return { ...framing, zoom: clamp(zoom, 1, MAX_ZOOM) };
}

/**
 * Drags the photo by (dx, dy) pixels inside a view of viewSize pixels. The
 * photo follows the pointer, so the selected square moves the other way, and
 * it stops at the photo's edges.
 */
export function panFraming(
  width: number,
  height: number,
  framing: Framing,
  dx: number,
  dy: number,
  viewSize: number,
): Framing {
  const turned = turnedSize(width, height, framing);
  const { x, y, side } = cropRect(width, height, framing);
  const scale = side / viewSize;
  const nextX = clamp(x - dx * scale, 0, turned.width - side);
  const nextY = clamp(y - dy * scale, 0, turned.height - side);
  return {
    ...framing,
    centerX: (nextX + side / 2) / turned.width,
    centerY: (nextY + side / 2) / turned.height,
  };
}

/** Turns the photo by quarter turns (positive is clockwise), keeping what is in view. */
export function rotateFraming(framing: Framing, turns: number): Framing {
  let next = framing;
  const step = Math.sign(turns);
  for (let i = 0; i < Math.abs(turns); i++) {
    next = {
      ...next,
      quarterTurns: (next.quarterTurns + step + 4) % 4,
      centerX: step > 0 ? 1 - next.centerY : next.centerY,
      centerY: step > 0 ? next.centerX : 1 - next.centerX,
    };
  }
  return next;
}

/** Paints the framed square onto a canvas context, scaled to size pixels. */
export function drawFraming(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource & { width: number; height: number },
  framing: Framing,
  size: number,
) {
  const { x, y, side } = cropRect(image.width, image.height, framing);
  const turned = turnedSize(image.width, image.height, framing);
  context.save();
  context.clearRect(0, 0, size, size);
  context.scale(size / side, size / side);
  context.translate(-x, -y);
  context.translate(turned.width / 2, turned.height / 2);
  context.rotate((framing.quarterTurns * Math.PI) / 2);
  context.drawImage(image, -image.width / 2, -image.height / 2);
  context.restore();
}

/**
 * Turns the framed square into a small photo: 256 px, WebP (or JPEG where WebP
 * is not available), under 200 KB. Drawing it again also drops metadata such
 * as location.
 */
export async function renderAvatar(
  image: CanvasImageSource & { width: number; height: number },
  framing: Framing,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("canvas is unavailable");
  drawFraming(context, image, framing, AVATAR_SIZE);
  for (const type of ["image/webp", "image/jpeg"]) {
    for (const quality of [0.9, 0.8, 0.65, 0.5]) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, type, quality),
      );
      // A browser without WebP answers with PNG; try the next format instead.
      if (blob !== null && blob.type === type && blob.size <= MAX_BYTES)
        return blob;
    }
  }
  throw new Error("the photo could not be made small enough");
}
