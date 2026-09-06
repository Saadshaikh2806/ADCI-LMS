import "server-only";

type ErrorContext = Record<string, unknown>;

function safeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: process.env.NODE_ENV === "production" ? undefined : error.stack
    };
  }
  return { name: "UnknownError", message: String(error) };
}

export function reportServerError(area: string, error: unknown, context: ErrorContext = {}) {
  console.error(JSON.stringify({
    level: "error",
    service: "adci-lms",
    area,
    timestamp: new Date().toISOString(),
    error: safeError(error),
    ...context
  }));
}
