import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireServerUser } from "../../../../lib/supabase/server";
import { getR2BucketName, getR2Client } from "../../../../lib/r2/client";

export const runtime = "nodejs";

type UploadAssetType = "video" | "audio" | "pdf";
type UploadRule = { extensions: ReadonlySet<string>; contentTypes: ReadonlySet<string>; maxBytes: number };

const uploadRules: Record<UploadAssetType, UploadRule> = {
  video: {
    extensions: new Set(["mp4", "webm"]),
    contentTypes: new Set(["video/mp4", "video/webm"]),
    maxBytes: 2 * 1024 * 1024 * 1024
  },
  audio: {
    extensions: new Set(["mp3", "m4a", "wav", "ogg"]),
    contentTypes: new Set(["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave", "audio/ogg"]),
    maxBytes: 250 * 1024 * 1024
  },
  pdf: {
    extensions: new Set(["pdf"]),
    contentTypes: new Set(["application/pdf"]),
    maxBytes: 50 * 1024 * 1024
  }
};

function errorResponse(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : "Unable to prepare upload";
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const { userClient } = await requireServerUser(request);
    const body = await request.json() as {
      lessonId?: string;
      fileName?: string;
      contentType?: string;
      fileSize?: number;
      assetType?: UploadAssetType;
    };

    if (!body.lessonId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.lessonId)) throw new Error("A valid lesson is required before uploading");
    if (!body.fileName || !body.assetType || !Object.prototype.hasOwnProperty.call(uploadRules, body.assetType) || !body.contentType || !Number.isSafeInteger(body.fileSize) || (body.fileSize ?? 0) <= 0) {
      throw new Error("Valid file details are required before uploading");
    }
    const extension = (body.fileName.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const rule = uploadRules[body.assetType];
    if (!rule.extensions.has(extension) || !rule.contentTypes.has(body.contentType.toLowerCase())) {
      throw new Error(`Unsupported ${body.assetType} file format`);
    }
    if ((body.fileSize ?? 0) > rule.maxBytes) {
      throw new Error(`${body.assetType.toUpperCase()} files must be smaller than ${Math.round(rule.maxBytes / 1024 / 1024)} MB`);
    }

    const { data: allowed, error: roleError } = await userClient.rpc("adci_can_manage_lesson_assets", {
      target_lesson_id: body.lessonId
    });
    if (roleError) throw roleError;
    if (!allowed) return errorResponse(new Error("You do not have permission to manage this lesson"), 403);

    const objectPath = `${body.lessonId}/${crypto.randomUUID()}.${extension}`;

    const uploadUrl = await getSignedUrl(
      getR2Client(),
      new PutObjectCommand({
        Bucket: getR2BucketName(),
        Key: objectPath,
        ContentType: body.contentType.toLowerCase(),
        ContentLength: body.fileSize
      }),
      { expiresIn: 10 * 60 }
    );

    return Response.json({ uploadUrl, objectPath }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
