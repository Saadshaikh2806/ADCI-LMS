import "server-only";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getR2BucketName, getR2Client } from "./client";

export async function cleanupDeletedLessonFiles(service: SupabaseClient) {
  const { data: jobs, error } = await service.from("adci_lesson_file_cleanup")
    .select("id,storage_provider,bucket,object_path").order("last_attempt_at").limit(20);
  if (error) throw error;
  let deleted = 0;
  let failed = 0;
  // Generated object paths are unique; repeated deletes after a crash are safe.
  for (const job of jobs ?? []) {
    try {
      const references = await Promise.all(["adci_lesson_assets", "adci_video_assets"].map(table =>
        service.from(table).select("id").eq("storage_provider", job.storage_provider)
          .eq("object_path", job.object_path).limit(1)
      ));
      for (const result of references) if (result.error) throw result.error;
      if (!references.some(result => result.data?.length)) {
        if (job.storage_provider === "r2") {
          await getR2Client().send(new DeleteObjectCommand({ Bucket: getR2BucketName(), Key: job.object_path }));
        } else {
          const { error: storageError } = await service.storage.from(job.bucket).remove([job.object_path]);
          if (storageError) throw storageError;
        }
      }
      const { error: deleteError } = await service.from("adci_lesson_file_cleanup").delete().eq("id", job.id);
      if (deleteError) throw deleteError;
      deleted++;
    } catch (cleanupError) {
      failed++;
      const message = cleanupError instanceof Error ? cleanupError.message : "File cleanup failed";
      await service.from("adci_lesson_file_cleanup").update({ last_error: message, last_attempt_at: new Date().toISOString() }).eq("id", job.id);
    }
  }
  return { deleted, failed };
}
