import { requireServerUser } from "../../../../lib/supabase/server";
import { apiErrorHeaders, apiErrorStatus, enforceApiRateLimit } from "../../../../lib/security/rate-limit";
import { whiteboardChannelName } from "../../../../lib/live/whiteboard-server";
import { normaliseScene, sceneWithinLimit } from "../../../../lib/live/whiteboard";

export const runtime = "nodejs";

const LESSON_ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

type ZoomAccess = {
  is_staff: boolean;
  can_join: boolean;
};

type WhiteboardRow = {
  scene: unknown;
  students_may_draw: boolean;
};

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "The whiteboard could not be opened";
}

function errorStatus(error: unknown) {
  const message = errorMessage(error);
  if (message.includes("not configured")) return 503;
  return apiErrorStatus(error, 403);
}

async function authorise(request: Request, lessonId: string | null) {
  if (!lessonId || !LESSON_ID.test(lessonId)) throw new Error("Choose a valid Zoom Live session");
  const { user, service } = await requireServerUser(request);
  await enforceApiRateLimit(service, user.id, "whiteboard", 90, 60);

  const { data, error } = await service.rpc("adci_get_zoom_access", {
    target_lesson_id: lessonId,
    target_user_id: user.id
  });
  if (error) throw error;
  const access = data as ZoomAccess;
  if (!access.can_join) throw new Error("The whiteboard opens 15 minutes before the session");

  return { user, service, access, lessonId };
}

async function loadRow(
  service: Awaited<ReturnType<typeof requireServerUser>>["service"],
  lessonId: string
): Promise<WhiteboardRow> {
  const { data, error } = await service
    .from("adci_live_whiteboards")
    .select("scene,students_may_draw")
    .eq("lesson_id", lessonId)
    .maybeSingle();
  if (error) throw error;
  return (data as WhiteboardRow | null) ?? { scene: null, students_may_draw: false };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const { service, access, lessonId } = await authorise(request, url.searchParams.get("lessonId"));
    const row = await loadRow(service, lessonId);

    return Response.json(
      {
        channel: whiteboardChannelName(lessonId),
        isHost: access.is_staff,
        studentsMayDraw: row.students_may_draw,
        canDraw: access.is_staff || row.students_may_draw,
        scene: normaliseScene(row.scene)
      },
      { headers: { "cache-control": "private, no-store" } }
    );
  } catch (error) {
    return Response.json(
      { error: errorMessage(error) },
      { status: errorStatus(error), headers: { ...apiErrorHeaders(error), "cache-control": "private, no-store" } }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      lessonId?: string;
      scene?: unknown;
      studentsMayDraw?: unknown;
    };
    const { user, service, access, lessonId } = await authorise(request, body.lessonId ?? null);
    const row = await loadRow(service, lessonId);

    const wantsSceneWrite = body.scene !== undefined;
    const wantsPermsWrite = body.studentsMayDraw !== undefined;
    if (!wantsSceneWrite && !wantsPermsWrite) throw new Error("Nothing to save");

    // Only a host can hand drawing rights to learners.
    if (wantsPermsWrite && !access.is_staff) throw new Error("Only the host can change who may draw");
    // A learner may persist the scene only while the host has drawing enabled.
    if (wantsSceneWrite && !access.is_staff && !row.students_may_draw) {
      throw new Error("The host has not enabled learner drawing");
    }

    const update: Record<string, unknown> = {
      lesson_id: lessonId,
      updated_by: user.id,
      updated_at: new Date().toISOString()
    };
    if (wantsSceneWrite) {
      const scene = normaliseScene(body.scene);
      if (!sceneWithinLimit(scene)) throw new Error("The whiteboard is full. Clear it to keep drawing.");
      update.scene = scene;
    }
    if (wantsPermsWrite) {
      update.students_may_draw = Boolean(body.studentsMayDraw);
    }

    const { error } = await service.from("adci_live_whiteboards").upsert(update, { onConflict: "lesson_id" });
    if (error) throw error;

    return Response.json({ ok: true }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return Response.json(
      { error: errorMessage(error) },
      { status: errorStatus(error), headers: { ...apiErrorHeaders(error), "cache-control": "private, no-store" } }
    );
  }
}
