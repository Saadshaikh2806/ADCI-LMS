import "server-only";

import { S3Client } from "@aws-sdk/client-s3";
import { requireServerEnvironment } from "../supabase/server";

let client: S3Client | undefined;

export function getR2Client() {
  if (client) return client;

  client = new S3Client({
    region: "auto",
    endpoint: `https://${requireServerEnvironment("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireServerEnvironment("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireServerEnvironment("R2_SECRET_ACCESS_KEY")
    }
  });

  return client;
}

export function getR2BucketName() {
  return requireServerEnvironment("R2_BUCKET_NAME");
}
