import { requireServerUser } from "../../../../../lib/supabase/server";
import { endZoomMeeting } from "../../../../../lib/zoom/server";
import { apiErrorHeaders, apiErrorStatus, enforceApiRateLimit } from "../../../../../lib/security/rate-limit";

export const runtime = "nodejs";

type ZoomAccess = {
  meeting_number: string;
  is_staff: boolean;
};

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") return error.message;
  return "The Zoom meeting could not be ended";
}

export async function POST(request: Request) {
  try {
    const { user, service } = await requireServerUser(request);
    await enforceApiRateLimit(service, user.id, "zoom-end", 20, 300);
    const body = (await request.json()) as { lessonId?: string };
    if (!body.lessonId?.match(/^[0-9a-f-]{36}$/i)) throw new Error("Choose a valid Zoom Live session");

    const { data, error } = await service.rpc("adci_get_zoom_access", {
      target_lesson_id: body.lessonId,
      target_user_id: user.id
    });
    if (error) throw error;
    const access = data as ZoomAccess;
    if (!access.is_staff) throw new Error("Only staff can end a Zoom Live session");

    await endZoomMeeting(access.meeting_number);
    return Response.json({ ok: true }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const message = errorMessage(error);
    return Response.json(
      { error: message },
      {
        status: apiErrorStatus(error, message.includes("not configured") ? 503 : 403),
        headers: { ...apiErrorHeaders(error), "cache-control": "private, no-store" }
      }
    );
  }
}
