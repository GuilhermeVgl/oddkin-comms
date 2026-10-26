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
const MAX_BYTES = 200 * 1024;

/** The square to cut from the middle of an image of this size. */
export function centerSquare(width: number, height: number) {
  const side = Math.min(width, height);
  return {
    x: Math.floor((width - side) / 2),
    y: Math.floor((height - side) / 2),
    side,
  };
}

/**
 * Turns whatever the person picked into a small square photo: cut from the
 * middle, 256 px, WebP (or JPEG where WebP is not available), under 200 KB.
 * Drawing it again also drops metadata such as location.
 */
export async function resizeToAvatar(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const { x, y, side } = centerSquare(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("canvas is unavailable");
  context.drawImage(bitmap, x, y, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close();
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
