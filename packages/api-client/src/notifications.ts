import {
  ApiStatusError,
  csrf,
  ensure,
  type Client,
  type Schemas,
} from "./internal";

export type Notification = Schemas["Notification"];

export async function listNotifications(
  client: Client,
): Promise<Notification[]> {
  const { data, response } = await client.GET("/api/v1/notifications");
  return ensure("listNotifications", response, data, 200);
}

export async function markNotificationRead(
  client: Client,
  token: string,
  notificationId: string,
): Promise<void> {
  const { response } = await client.POST(
    "/api/v1/notifications/{notificationId}/read",
    { params: { path: { notificationId } }, headers: csrf(token) },
  );
  if (response.status !== 204) {
    throw new ApiStatusError(response.status, "markNotificationRead");
  }
}

export async function markAllNotificationsRead(
  client: Client,
  token: string,
): Promise<void> {
  const { response } = await client.POST("/api/v1/notifications/read-all", {
    headers: csrf(token),
  });
  if (response.status !== 204) {
    throw new ApiStatusError(response.status, "markAllNotificationsRead");
  }
}
