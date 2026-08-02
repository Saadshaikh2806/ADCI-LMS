import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireServerUser } from "../../../../lib/supabase/server";
import { getR2BucketName, getR2Client } from "../../../../lib/r2/client";

export const runtime = "nodejs";

const staffPlaybackRoles = ["instructor", "content_author", "academic_lead", "branch_admin", "super_admin"];

function errorResponse(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : "Unable to open this video";
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const { user, service } = await requireServerUser(request);
    const body = await request.json() as { lessonId?: string; objectPath?: string };

    if (!body.lessonId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.lessonId) || !body.objectPath || body.objectPath.length > 500) {
      throw new Error("A valid lesson and asset are required");
    }
    const [lessonAssetResult, videoAssetResult] = await Promise.all([
      service.from("adci_lesson_assets").select("lesson_id").eq("lesson_id", body.lessonId).eq("object_path", body.objectPath).eq("storage_provider", "r2").maybeSingle(),
      service.from("adci_video_assets").select("lesson_id").eq("lesson_id", body.lessonId).eq("object_path", body.objectPath).eq("storage_provider", "r2").maybeSingle()
    ]);
    if (lessonAssetResult.error) throw lessonAssetResult.error;
    if (videoAssetResult.error) throw videoAssetResult.error;
    if (!lessonAssetResult.data && !videoAssetResult.data) {
      return errorResponse(new Error("This protected file is not registered for the selected lesson"), 403);
    }

    const { data: lesson, error: lessonError } = await service.from("adci_lessons").select("module_id").eq("id", body.lessonId).maybeSingle();
    if (lessonError) throw lessonError;
    if (!lesson) return errorResponse(new Error("This lesson is not available to your account"), 403);
    const { data: module, error: moduleError } = await service.from("adci_modules").select("course_id").eq("id", lesson.module_id).maybeSingle();
    if (moduleError) throw moduleError;
    if (!module) return errorResponse(new Error("This lesson is not available to your account"), 403);
    const { data: course, error: courseError } = await service.from("adci_courses").select("organization_id").eq("id", module.course_id).maybeSingle();
    if (courseError) throw courseError;
    if (!course) return errorResponse(new Error("This lesson is not available to your account"), 403);

    const [enrolmentResult, membershipResult] = await Promise.all([
      service.from("adci_enrolments").select("status,access_expires_at").eq("course_id", module.course_id).eq("learner_id", user.id).in("status", ["active", "completed"]).maybeSingle(),
      service.from("adci_memberships").select("id").eq("organization_id", course.organization_id).eq("user_id", user.id).eq("active", true).in("role", staffPlaybackRoles).limit(1).maybeSingle()
    ]);
    if (enrolmentResult.error) throw enrolmentResult.error;
    if (membershipResult.error) throw membershipResult.error;
    const enrolmentActive = Boolean(enrolmentResult.data) && (
      !enrolmentResult.data?.access_expires_at || new Date(enrolmentResult.data.access_expires_at).getTime() > Date.now()
    );
    if (!enrolmentActive && !membershipResult.data) {
      return errorResponse(new Error("This lesson is not available to your account"), 403);
    }

    const signedUrl = await getSignedUrl(
      getR2Client(),
      new GetObjectCommand({ Bucket: getR2BucketName(), Key: body.objectPath }),
      { expiresIn: 15 * 60 }
    );

    return Response.json({ signedUrl }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
