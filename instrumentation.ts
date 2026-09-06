import { reportServerError } from "./lib/observability/server";

export async function register() {
  // Next.js loads this once per server runtime. Platform log drains can ingest
  // the resulting structured JSON without coupling the LMS to one vendor.
}

export function onRequestError(
  error: unknown,
  request: { path?: string; method?: string; headers?: Record<string, string> },
  context: { routePath?: string; routeType?: string; renderSource?: string }
) {
  reportServerError("next-request", error, {
    method: request.method,
    path: request.path,
    requestId: request.headers?.["x-request-id"],
    routePath: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource
  });
}
