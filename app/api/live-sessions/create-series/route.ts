import { requireServerUser } from "../../../../lib/supabase/server";

export const runtime = "nodejs";

type SeriesRequest = {
  title?: string;
  description?: string;
  instructor?: string;
  startsAt?: string;
  durationMinutes?: number;
  recurrence?: "once" | "weekly";
  repeatUntil?: string;
  pricePaise?: number;
  gstRate?: number;
};

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") return error.message;
  return "Unable to create live sessions";
}

function indiaDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function buildStarts(first: Date, recurrence: SeriesRequest["recurrence"], repeatUntil?: string) {
  if (recurrence !== "weekly") return [first];
  if (!repeatUntil?.match(/^\d{4}-\d{2}-\d{2}$/)) throw new Error("Choose the final recurrence date");

  const starts: Date[] = [];
  for (let cursor = new Date(first); indiaDateKey(cursor) <= repeatUntil; cursor = new Date(cursor.getTime() + 7 * 86400000)) {
    starts.push(cursor);
    if (starts.length > 10) throw new Error("Create at most 10 weekly sessions at a time");
  }
  if (!starts.length) throw new Error("The final date must include the first session");
  return starts;
}

export async function POST(request: Request) {
  try {
    const { userClient } = await requireServerUser(request);
    const body = await request.json() as SeriesRequest;
    const title = body.title?.trim() || "";
    const instructor = body.instructor?.trim() || "";
    const firstStart = new Date(body.startsAt || "");
    const durationMinutes = Number(body.durationMinutes);
    const pricePaise = Number(body.pricePaise);
    const gstRate = Number(body.gstRate);

    if (title.length < 3 || instructor.length < 2) throw new Error("Enter a session title and instructor");
    if (!Number.isFinite(firstStart.getTime()) || firstStart <= new Date()) throw new Error("Choose a future start time");
    if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 60) {
      throw new Error("Agora sessions must be between 15 and 60 minutes");
    }
    if (!Number.isInteger(pricePaise) || pricePaise < 100) throw new Error("Price must be at least INR 1");
    if (!Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100) throw new Error("GST must be between 0 and 100");

    const { error: permissionError } = await userClient.rpc("adci_admin_get_live_schedule", { target_days: 7 });
    if (permissionError) throw permissionError;

    const starts = buildStarts(firstStart, body.recurrence, body.repeatUntil);
    const occurrences = starts.map((start) => ({
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + durationMinutes * 60000).toISOString()
    }));

    const { data, error } = await userClient.rpc("adci_create_bookable_live_series", {
      session_title: title,
      session_description: body.description?.trim() || "",
      session_instructor: instructor,
      session_price_paise: pricePaise,
      session_gst_rate: gstRate,
      session_occurrences: occurrences
    });
    if (error) throw error;
    return Response.json(data);
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 400 });
  }
}
