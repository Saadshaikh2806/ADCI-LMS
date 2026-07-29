import { getSupabaseBrowserClient } from "./client";

export type LearningAsset = {
  bucket: "adci-lesson-assets" | "adci-course-videos";
  object_path: string;
  mime_type: string;
  original_name: string;
  asset_type: "video" | "audio" | "pdf";
};

export type LearningLiveClass = {
  provider: "zoom" | "google_meet" | "youtube_live";
  instructor_name: string;
  starts_at: string;
  ends_at: string;
  can_join: boolean;
  has_attended: boolean;
};

export type LearningLesson = {
  id: string;
  title: string;
  lesson_type: "video" | "audio" | "pdf" | "html" | "live" | "quiz";
  position: number;
  duration_seconds: number;
  status: string;
  progress_percent: number;
  position_seconds: number;
  completed: boolean;
  asset: LearningAsset | null;
  article_body: string | null;
  live_class: LearningLiveClass | null;
  quiz: { assessment_id: string; title: string } | null;
};

export type LearningCourse = {
  id: string;
  title: string;
  slug: string;
  description: string;
  modules: Array<{
    id: string;
    title: string;
    position: number;
    lessons: LearningLesson[];
  }>;
};

export type DashboardLesson = {
  id: string;
  title: string;
  lesson_type: LearningLesson["lesson_type"];
  module_title: string;
  duration_seconds: number;
  progress_percent: number;
  position_seconds: number;
};

export type DashboardCourse = {
  id: string;
  title: string;
  slug: string;
  description: string;
  lesson_count: number;
  completed_count: number;
  next_lesson: DashboardLesson | null;
};

export type LearnerDashboard = {
  courses: DashboardCourse[];
  continue_lesson: {
    course_id: string;
    course_title: string;
    course_slug: string;
    lesson_id: string;
    lesson_title: string;
    lesson_type: LearningLesson["lesson_type"];
    module_title: string;
    duration_seconds: number;
    progress_percent: number;
    position_seconds: number;
  } | null;
  upcoming_live_count: number;
  tests_completed: number;
  assessments_due: number;
  correct_answers: number;
  answered_questions: number;
  accuracy_percent: number;
  learning_seconds: number;
  weekly_learning_seconds: number;
  streak_days: number;
};

export type LessonProgressInput = {
  lessonId: string;
  progressPercent: number;
  positionSeconds?: number;
  completed?: boolean;
};

export async function saveLessonProgress(input: LessonProgressInput) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");

  const { data, error } = await supabase.rpc("adci_mark_lesson_progress", {
    target_lesson_id: input.lessonId,
    target_progress: Math.min(100, Math.max(0, input.progressPercent)),
    target_position_seconds: Math.max(0, input.positionSeconds ?? 0),
    mark_complete: Boolean(input.completed)
  });
  if (error) throw error;
  return data as { lesson_id: string; progress_percent: number; position_seconds: number; completed: boolean };
}

export async function getLearningCourse(courseId: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");

  const { data, error } = await supabase.rpc("adci_get_course_learning_view", {
    target_course_id: courseId
  });
  if (error) throw error;
  return data as LearningCourse;
}

export async function getLearnerDashboard() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");

  const { data, error } = await supabase.rpc("adci_get_learner_dashboard");
  if (error) throw error;
  return data as LearnerDashboard;
}

export async function getProtectedLessonUrl(asset: LearningAsset) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");

  const { data, error } = await supabase.storage
    .from(asset.bucket)
    .createSignedUrl(asset.object_path, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}

export async function getProtectedVideoUrl(objectPath: string) {
  return getProtectedLessonUrl({
    bucket: "adci-course-videos",
    object_path: objectPath,
    mime_type: "video/mp4",
    original_name: "Recorded lesson",
    asset_type: "video"
  });
}

export async function loadMyEnrolments() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("adci_enrolments")
    .select("id,status,enrolled_at,adci_courses(id,title,slug,status)")
    .eq("status", "active")
    .order("enrolled_at", { ascending: false });

  if (error) throw error;
  return data;
}
