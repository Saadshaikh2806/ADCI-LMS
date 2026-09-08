import { requireServerUser } from "../../../../../lib/supabase/server";
import { deleteZoomMeeting, endZoomMeeting, ZoomApiError } from "../../../../../lib/zoom/server";
import { apiErrorHeaders, apiErrorStatus, enforceApiRateLimit } from "../../../../../lib/security/rate-limit";

export const runtime = "nodejs";

function errorMessage(error: unknown) {
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") return error.message;
  return "The Zoom meeting request failed";
}

export async function POST(request: Request) {
  try {
    const { user, userClient, service } = await requireServerUser(request);
    await enforceApiRateLimit(service, user.id, "zoom-end", 20, 300);
    const body = await request.json() as { lessonId?: string; alsoDelete?: boolean; purchasedLearners?: number };
    if (typeof body.lessonId !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(body.lessonId)) {
      throw new Error("Choose a valid Zoom Live session");
    }
    if (body.alsoDelete !== undefined && typeof body.alsoDelete !== "boolean") throw new Error("Invalid deletion request");

    const { data: pending, error: pendingError } = await service.from("adci_zoom_cleanup")
      .select("meeting_number,organization_id").eq("lesson_id", body.lessonId).maybeSingle();
    if (pendingError) throw pendingError;
    let access = pending;
    if (!access) {
      const { data, error } = await service.rpc("adci_get_zoom_access", {
        target_lesson_id: body.lessonId, target_user_id: user.id
      });
      if (error) throw error;
      access = data as { meeting_number: string; organization_id: string };
    }
    const { data: allowed, error: permissionError } = await userClient.rpc("adci_current_user_has_role", {
      requested_org: access.organization_id,
      allowed_roles: body.alsoDelete
        ? ["content_author", "academic_lead", "branch_admin", "super_admin"]
        : ["instructor", "content_author", "academic_lead", "branch_admin", "super_admin"]
    });
    if (permissionError || !allowed) throw new Error("Live schedule administration permission required");

    if (!body.alsoDelete) {
      await endZoomMeeting(access.meeting_number);
      // The class expires in the LMS the moment the host ends it for all.
      await service.rpc("adci_set_live_runtime_state", {
        target_meeting_number: access.meeting_number, mark_started: false, mark_ended: true
      });
      return Response.json({ ok: true }, { headers: apiErrorHeaders(null) });
    }

    if (!pending) {
      if (!Number.isSafeInteger(body.purchasedLearners) || body.purchasedLearners! < 0) throw new Error("Open the purchase confirmation before deleting");
      // The database checks purchases and permissions and atomically queues cleanup.
      // No Zoom request is made unless that transaction commits.
      const { error } = await userClient.rpc("adci_admin_delete_live_schedule", {
        target_lesson_id: body.lessonId, confirmed_purchased_learners: body.purchasedLearners
      });
      if (error) throw error;
    }
    try {
      await endZoomMeeting(access.meeting_number);
      await deleteZoomMeeting(access.meeting_number);
      const { error } = await service.from("adci_zoom_cleanup").delete().eq("lesson_id", body.lessonId);
      if (error) throw error;
      return Response.json({ ok: true, zoomRemoved: true }, { headers: apiErrorHeaders(null) });
    } catch (error) {
      const warning = errorMessage(error);
      const { error: saveError } = await service.from("adci_zoom_cleanup").update({ last_error: warning }).eq("lesson_id", body.lessonId);
      if (saveError) console.error("Could not save Zoom cleanup failure", saveError.message);
      return Response.json({ ok: true, zoomRemoved: false, warning }, { headers: apiErrorHeaders(null) });
    }
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, {
      status: apiErrorStatus(error, error instanceof ZoomApiError ? 502 : 403), headers: apiErrorHeaders(error)
    });
  }
}
