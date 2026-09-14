import { requireServerUser } from "../../../../lib/supabase/server";
import { cleanupDeletedLessonFiles } from "../../../../lib/r2/cleanup";
import { apiErrorHeaders, apiErrorStatus, enforceApiRateLimit } from "../../../../lib/security/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { user, userClient, service } = await requireServerUser(request);
    await enforceApiRateLimit(service, user.id, "academic-delete", 20, 3600);
    const body = await request.json() as { kind?: string; id?: string };
    if (!body.kind || !["course", "module", "lesson"].includes(body.kind)
      || typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id)) {
      throw new Error("Choose a valid curriculum item to delete");
    }
    const { error } = await userClient.rpc("adci_delete_academic_entity", { entity_kind: body.kind, target_id: body.id });
    if (error) throw new Error(error.message);
    // Curriculum deletion is committed. A storage outage must not report it as failed.
    await cleanupDeletedLessonFiles(service).catch(error => console.error("Lesson cleanup deferred", error));
    return Response.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to delete curriculum" },
      { status: apiErrorStatus(error), headers: apiErrorHeaders(error) });
  }
}
