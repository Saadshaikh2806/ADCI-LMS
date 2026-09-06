import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export class ApiRateLimitError extends Error {
  readonly retryAfter: number;

  constructor(retryAfter: number) {
    super("Too many requests. Please wait and try again.");
    this.name = "ApiRateLimitError";
    this.retryAfter = retryAfter;
  }
}

export async function enforceApiRateLimit(
  service: SupabaseClient,
  userId: string,
  scope: string,
  maximumRequests: number,
  windowSeconds: number
) {
  if (!/^[a-z0-9:_-]{2,80}$/i.test(scope)) throw new Error("Invalid API rate-limit scope");
  const { data, error } = await service.rpc("adci_take_api_rate_limit", {
    p_request_key: `${userId}:${scope}`,
    p_maximum_requests: maximumRequests,
    p_interval_seconds: windowSeconds
  });
  if (error) throw error;
  if (!data) throw new ApiRateLimitError(windowSeconds);
}

export function apiErrorStatus(error: unknown, fallback = 400) {
  return error instanceof ApiRateLimitError ? 429 : fallback;
}

export function apiErrorHeaders(error: unknown): Record<string, string> {
  return error instanceof ApiRateLimitError
    ? { "Retry-After": String(error.retryAfter), "Cache-Control": "no-store" }
    : { "Cache-Control": "no-store" };
}
