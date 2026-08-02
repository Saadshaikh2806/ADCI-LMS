import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireServerUser } from "../../../../lib/supabase/server";
import { getR2BucketName, getR2Client } from "../../../../lib/r2/client";

export const runtime = "nodejs";

function errorResponse(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : "Unable to open this video";
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const { userClient } = await requireServerUser(request);
    const body = await request.json() as { lessonId?: string; objectPath?: string };

    if (!body.lessonId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.lessonId) || !body.objectPath || body.objectPath.length > 500) {
      throw new Error("A valid lesson and asset are required");
    }
    const { data: allowed, error: accessError } = await userClient.rpc("adci_can_access_lesson_asset", {
      target_lesson_id: body.lessonId,
      target_object_path: body.objectPath
    });
    if (accessError) throw accessError;
    if (!allowed) return errorResponse(new Error("This lesson is not available to your account"), 403);

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
