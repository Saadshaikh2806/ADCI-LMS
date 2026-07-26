import { getSupabaseBrowserClient } from "./client";

export type LessonProgressInput = {
  lessonId: string;
  progressPercent: number;
  positionSeconds?: number;
  completed?: boolean;
};

export async function saveLessonProgress(input: LessonProgressInput) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return { persisted: false as const, reason: "demo-mode" as const };

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) throw authError ?? new Error("Authentication required");

  const { error } = await supabase.from("lesson_progress").upsert(
    {
      learner_id: authData.user.id,
      lesson_id: input.lessonId,
      progress_percent: Math.min(100, Math.max(0, input.progressPercent)),
      position_seconds: input.positionSeconds ?? 0,
      completed_at: input.completed ? new Date().toISOString() : null,
      last_activity_at: new Date().toISOString()
    },
    { onConflict: "learner_id,lesson_id" }
  );

  if (error) throw error;
  return { persisted: true as const };
}

export async function getProtectedVideoUrl(objectPath: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;

  const { data, error } = await supabase.storage
    .from("course-videos")
    .createSignedUrl(objectPath, 15 * 60);

  if (error) throw error;
  return data.signedUrl;
}

export async function loadMyEnrolments() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("enrolments")
    .select("id,status,enrolled_at,courses(id,title,slug,status)")
    .eq("status", "active")
    .order("enrolled_at", { ascending: false });

  if (error) throw error;
  return data;
}
