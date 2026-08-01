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

    if (!body.lessonId || !body.objectPath) throw new Error("A lesson and asset are required");
    const { data: allowed, error: accessError } = await userClient.rpc("adci_can_access_lesson", {
      target_lesson_id: body.lessonId
    });
    if (accessError) throw accessError;
    if (!allowed) return errorResponse(new Error("This lesson is not available to your account"), 403);

    const signedUrl = await getSignedUrl(
      getR2Client(),
      new GetObjectCommand({ Bucket: getR2BucketName(), Key: body.objectPath }),
      { expiresIn: 60 * 60 }
    );

    return Response.json({ signedUrl });
  } catch (error) {
    return errorResponse(error);
  }
}
