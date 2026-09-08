// Shared between the create-series API route and the admin scheduling dialog so
// the clash preview checks exactly the slots the series would occupy.

export type LiveOccurrence = { starts_at: string; ends_at: string };

export const MAX_LIVE_SERIES_OCCURRENCES = 10;

export function indiaDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function buildLiveSeriesStarts(
  first: Date,
  recurrence: "once" | "weekly" | undefined,
  repeatUntil?: string
) {
  if (recurrence !== "weekly") return [first];
  if (!repeatUntil?.match(/^\d{4}-\d{2}-\d{2}$/)) throw new Error("Choose the final recurrence date");

  const starts: Date[] = [];
  for (let cursor = new Date(first); indiaDateKey(cursor) <= repeatUntil; cursor = new Date(cursor.getTime() + 7 * 86400000)) {
    starts.push(cursor);
    if (starts.length > MAX_LIVE_SERIES_OCCURRENCES) throw new Error("Create at most 10 weekly sessions at a time");
  }
  if (!starts.length) throw new Error("The final date must include the first session");
  return starts;
}

export function buildLiveSeriesOccurrences(input: {
  startsAt: Date;
  durationMinutes: number;
  recurrence: "once" | "weekly" | undefined;
  repeatUntil?: string;
}): LiveOccurrence[] {
  return buildLiveSeriesStarts(input.startsAt, input.recurrence, input.repeatUntil).map((start) => ({
    starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + input.durationMinutes * 60000).toISOString()
  }));
}
