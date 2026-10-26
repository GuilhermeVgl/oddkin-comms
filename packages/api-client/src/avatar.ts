import type { components } from "./openapi.gen";
import { readCsrfFromCookies, type createApiClient } from "./index";

export type AvatarVersion = components["schemas"]["AvatarVersion"];

export async function listAvatars(
  client: ReturnType<typeof createApiClient>,
): Promise<AvatarVersion[]> {
  const { data, response } = await client.GET("/api/v1/avatars");
  if (response.status === 200 && data !== undefined) return data;
  throw new Error(`Unexpected avatars status: ${response.status}`);
}

/** Uploads the caller's photo, already resized by the browser. */
export async function putAvatar(photo: Blob): Promise<void> {
  const token = readCsrfFromCookies(document.cookie);
  const response = await fetch("/api/v1/account/avatar", {
    method: "PUT",
    headers: {
      "Content-Type": photo.type,
      ...(token === null ? {} : { "X-CSRF-Token": token }),
    },
    body: photo,
  });
  if (response.status !== 204)
    throw new Error(`Unexpected avatar status: ${response.status}`);
}

export async function deleteAvatar(
  client: ReturnType<typeof createApiClient>,
): Promise<void> {
  const { response } = await client.DELETE("/api/v1/account/avatar", {});
  if (response.status !== 204)
    throw new Error(`Unexpected avatar status: ${response.status}`);
}
