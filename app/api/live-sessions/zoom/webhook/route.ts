import { createHmac, timingSafeEqual } from "node:crypto";
import { getServerServiceSupabase } from "../../../../../lib/supabase/server";

export const runtime = "nodejs";

// Optional: keeps "extended" / "ended" instant. Without it the LMS still
// reconciles Zoom state whenever someone opens a session and via the hard
// starts_at + 6h ceiling. Configure the same secret token on the Zoom
// Marketplace app and subscribe to "Meeting Started" and "Meeting Ended".
function secretToken() {
  return process.env.ZOOM_WEBHOOK_SECRET_TOKEN?.trim() || "";
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  const secret = secretToken();
  if (!secret) return new Response("Zoom webhook is not enabled", { status: 404 });

  const raw = await request.text();
  const timestamp = request.headers.get("x-zm-request-timestamp") ?? "";
  const signature = request.headers.get("x-zm-signature") ?? "";

  let body: { event?: string; payload?: Record<string, unknown> };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  // Zoom's endpoint ownership handshake.
  if (body.event === "endpoint.url_validation") {
    const plainToken = String((body.payload as { plainToken?: string })?.plainToken ?? "");
    const encryptedToken = createHmac("sha256", secret).update(plainToken).digest("hex");
    return Response.json({ plainToken, encryptedToken });
  }

  // Reject anything without a fresh, correctly signed body.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!timestamp || !Number.isFinite(age) || age > 300) return new Response("Stale", { status: 401 });
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${raw}`).digest("hex")}`;
  if (!safeEqual(signature, expected)) return new Response("Unauthorized", { status: 401 });

  const meetingId = (body.payload as { object?: { id?: unknown } })?.object?.id;
  const meetingNumber = meetingId === undefined || meetingId === null ? "" : String(meetingId);
  if (meetingNumber && (body.event === "meeting.started" || body.event === "meeting.ended")) {
    const service = getServerServiceSupabase();
    const { error } = await service.rpc("adci_set_live_runtime_state", {
      target_meeting_number: meetingNumber,
      mark_started: body.event === "meeting.started",
      mark_ended: body.event === "meeting.ended"
    });
    if (error) {
      console.error("Zoom webhook could not update live runtime state", error.message);
      return new Response("Retry", { status: 500 });
    }
  }

  return new Response(null, { status: 204 });
}
