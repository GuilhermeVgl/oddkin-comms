import type { components } from "./openapi.gen";
import type { createApiClient } from "./index";

export type Client = ReturnType<typeof createApiClient>;
export type Schemas = components["schemas"];

export class ApiStatusError extends Error {
  constructor(
    readonly status: number,
    operation: string,
  ) {
    super(`${operation} failed with status ${status}`);
  }
}

export function csrf(token: string) {
  return { "X-CSRF-Token": token };
}

export function ensure<T>(
  operation: string,
  response: Response,
  data: T | undefined,
  expected: number,
): T {
  if (response.status !== expected || data === undefined) {
    throw new ApiStatusError(response.status, operation);
  }
  return data;
}
