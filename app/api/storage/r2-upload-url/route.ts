import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireServerUser } from "../../../../lib/supabase/server";
import { getR2BucketName, getR2Client } from "../../../../lib/r2/client";

export const runtime = "nodejs";

function errorResponse(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : "Unable to prepare upload";
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const { userClient } = await requireServerUser(request);
    const body = await request.json() as { lessonId?: string; fileName?: string; contentType?: string };

    if (!body.lessonId) throw new Error("A lesson is required before uploading");
    const { data: allowed, error: roleError } = await userClient.rpc("adci_can_manage_lesson_assets", {
      target_lesson_id: body.lessonId
    });
    if (roleError) throw roleError;
    if (!allowed) return errorResponse(new Error("You do not have permission to manage this lesson"), 403);

    const extension = (body.fileName?.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
    const objectPath = `${body.lessonId}/${crypto.randomUUID()}.${extension}`;

    const uploadUrl = await getSignedUrl(
      getR2Client(),
      new PutObjectCommand({
        Bucket: getR2BucketName(),
        Key: objectPath,
        ContentType: body.contentType || "application/octet-stream"
      }),
      { expiresIn: 60 * 60 }
    );

    return Response.json({ uploadUrl, objectPath });
  } catch (error) {
    return errorResponse(error);
  }
}
