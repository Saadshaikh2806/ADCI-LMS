import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { requireServerUser } from "../../../../lib/supabase/server";
import { getR2BucketName, getR2Client } from "../../../../lib/r2/client";
import { apiErrorHeaders, apiErrorStatus, enforceApiRateLimit } from "../../../../lib/security/rate-limit";

export const runtime = "nodejs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const objectNamePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(mp4|webm|mp3|m4a|wav|ogg|pdf)$/i;

function errorResponse(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : "Unable to delete protected files";
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const { user, userClient, service } = await requireServerUser(request);
    await enforceApiRateLimit(service, user.id, "r2-delete", 20, 3600);
    const body = await request.json() as {
      objects?: Array<{ lessonId?: string; objectPath?: string }>;
    };

    if (!Array.isArray(body.objects) || body.objects.length === 0 || body.objects.length > 500) {
      throw new Error("Provide between 1 and 500 protected files to delete");
    }

    const uniqueObjects = [...new Map(body.objects.map((item) => [
      `${item.lessonId}:${item.objectPath}`,
      { lessonId: item.lessonId?.trim() ?? "", objectPath: item.objectPath?.trim() ?? "" }
    ])).values()];

    for (const item of uniqueObjects) {
      const [folder, ...remainingPath] = item.objectPath.split("/");
      if (!uuidPattern.test(item.lessonId) || folder !== item.lessonId || remainingPath.length !== 1 || !objectNamePattern.test(remainingPath[0])) {
        throw new Error("A protected file path is invalid");
      }
    }

    const lessonIds = [...new Set(uniqueObjects.map((item) => item.lessonId))];
    for (const lessonId of lessonIds) {
      const { data: allowed, error: roleError } = await userClient.rpc("adci_can_manage_lesson_assets", {
        target_lesson_id: lessonId
      });
      if (roleError) throw roleError;
      if (!allowed) return errorResponse(new Error("You do not have permission to manage one of these lessons"), 403);
    }

    const objectPaths = uniqueObjects.map((item) => item.objectPath);
    const [{ data: lessonAssets, error: lessonAssetError }, { data: videoAssets, error: videoAssetError }] = await Promise.all([
      service.from("adci_lesson_assets").select("lesson_id,object_path").eq("storage_provider", "r2").in("object_path", objectPaths),
      service.from("adci_video_assets").select("lesson_id,object_path").eq("storage_provider", "r2").in("object_path", objectPaths)
    ]);
    if (lessonAssetError) throw lessonAssetError;
    if (videoAssetError) throw videoAssetError;

    const boundPaths = new Set([...(lessonAssets ?? []), ...(videoAssets ?? [])].map((asset) => asset.object_path));
    const boundLessonIds = [...new Set(uniqueObjects.filter((item) => boundPaths.has(item.objectPath)).map((item) => item.lessonId))];

    // Removing an object already attached to curriculum is destructive and must
    // match the same elevated roles used by adci_delete_academic_entity.
    if (boundLessonIds.length > 0) {
      const { data: lessonRows, error: lessonError } = await service.from("adci_lessons").select("id,module_id").in("id", boundLessonIds);
      if (lessonError) throw lessonError;
      const moduleIds = [...new Set((lessonRows ?? []).map((lesson) => lesson.module_id))];
      const { data: moduleRows, error: moduleError } = await service.from("adci_modules").select("id,course_id").in("id", moduleIds);
      if (moduleError) throw moduleError;
      const courseIds = [...new Set((moduleRows ?? []).map((module) => module.course_id))];
      const { data: courseRows, error: courseError } = await service.from("adci_courses").select("id,organization_id").in("id", courseIds);
      if (courseError) throw courseError;
      const organizationIds = [...new Set((courseRows ?? []).map((course) => course.organization_id))];
      const { data: memberships, error: membershipError } = await service
        .from("adci_memberships")
        .select("organization_id")
        .eq("user_id", user.id)
        .eq("active", true)
        .in("organization_id", organizationIds)
        .in("role", ["academic_lead", "branch_admin", "super_admin"]);
      if (membershipError) throw membershipError;
      const authorizedOrganizations = new Set((memberships ?? []).map((membership) => membership.organization_id));
      if (organizationIds.some((organizationId) => !authorizedOrganizations.has(organizationId))) {
        return errorResponse(new Error("Academic lead permission is required to delete protected curriculum files"), 403);
      }
    }

    const deletion = await getR2Client().send(new DeleteObjectsCommand({
      Bucket: getR2BucketName(),
      Delete: {
        Objects: uniqueObjects.map((item) => ({ Key: item.objectPath })),
        Quiet: true
      }
    }));

    if (deletion.Errors?.length) {
      throw new Error(`Cloudflare R2 could not delete ${deletion.Errors.length} protected file(s)`);
    }

    return Response.json({ deleted: uniqueObjects.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to delete protected files" }, { status: apiErrorStatus(error), headers: apiErrorHeaders(error) });
  }
}
