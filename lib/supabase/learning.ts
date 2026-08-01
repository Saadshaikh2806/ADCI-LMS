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

export type LearnerLiveClass = {
  lesson_id: string;
  lesson_title: string;
  course_id: string;
  course_title: string;
  module_title: string;
  provider: "zoom" | "google_meet" | "youtube_live";
  instructor_name: string;
  starts_at: string;
  ends_at: string;
  can_join: boolean;
  has_attended: boolean;
  joined_at: string | null;
  last_joined_at: string | null;
  join_count: number;
};

export type LearnerAssessment = {
  id: string;
  title: string;
  course_id: string;
  course_title: string;
  lesson_id: string | null;
  lesson_title: string | null;
  module_title: string | null;
  duration_seconds: number;
  positive_marks: number;
  negative_marks: number;
  pass_percent: number;
  max_attempts: number;
  attempts_used: number;
  attempts_remaining: number;
  question_count: number;
  max_score: number;
  available_until: string | null;
  state: "available" | "in_progress" | "completed";
  can_start: boolean;
  active_attempt_id: string | null;
  server_deadline_at: string | null;
  latest_attempt_id: string | null;
  latest_score: number | null;
  latest_submitted_at: string | null;
  latest_timed_out: boolean;
  passed: boolean;
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

export async function getMyLiveClassWorkspace() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_get_my_live_class_workspace", {
    past_days: 180,
    future_days: 365
  });
  if (error) throw error;
  return (data ?? []) as LearnerLiveClass[];
}

export async function getMyAssessmentCentre() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_get_my_assessment_centre");
  if (error) throw error;
  return (data ?? []) as LearnerAssessment[];
}

export type AdciNotification = {
  id: string;
  source: "announcement" | "event";
  notification_type: "announcement" | "support" | "assignment" | "live_class" | "assessment" | "system";
  title: string;
  body: string;
  audience: "all" | "learners" | "staff" | "personal";
  priority: "info" | "important" | "urgent";
  published_at: string;
  expires_at: string | null;
  read: boolean;
  action_data: {
    kind?: "support" | "assignment" | "live_class" | "assessment";
    id?: string;
    course_id?: string;
    lesson_id?: string;
  };
};

export type AdciNotificationFeed = {
  unread_count: number;
  items: AdciNotification[];
};

export async function getMyNotifications() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_get_my_notifications");
  if (error) throw error;
  return data as AdciNotificationFeed;
}

export async function markAnnouncementRead(announcementId: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.rpc("adci_mark_announcement_read", {
    target_announcement_id: announcementId
  });
  if (error) throw error;
}

export async function markAllAnnouncementsRead() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.rpc("adci_mark_all_announcements_read");
  if (error) throw error;
}

export async function markNotificationRead(notificationId: string, source: AdciNotification["source"]) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.rpc("adci_mark_notification_read", {
    target_notification_id: notificationId,
    notification_source: source
  });
  if (error) throw error;
}

export async function markAllNotificationsRead() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.rpc("adci_mark_all_notifications_read");
  if (error) throw error;
}

export type LearnerAssignmentSubmission = {
  id: string;
  text_response: string | null;
  link_url: string | null;
  file_path: string | null;
  file_name: string | null;
  file_mime_type: string | null;
  file_size_bytes: number | null;
  status: "draft" | "submitted" | "graded" | "returned";
  submitted_at: string | null;
  score: number | null;
  feedback: string | null;
  graded_at: string | null;
  updated_at: string;
};

export type LearnerAssignment = {
  id: string;
  course_id: string;
  course_title: string;
  title: string;
  instructions: string;
  submission_type: "file" | "text" | "link" | "mixed";
  max_score: number;
  available_from: string | null;
  due_at: string | null;
  allowed_mime_types: string[];
  max_file_bytes: number;
  state: "pending" | "overdue" | "submitted" | "graded" | "returned";
  submission: LearnerAssignmentSubmission | null;
};

export async function getMyAssignments() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_get_my_assignments");
  if (error) throw error;
  return (data ?? []) as LearnerAssignment[];
}

export async function uploadAssignmentFile(assignmentId: string, file: File) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw userError ?? new Error("Authentication required");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const path = `${assignmentId}/${userData.user.id}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage
    .from("adci-assignment-submissions")
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
  if (error) throw error;
  return {
    path,
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size
  };
}

export async function saveMyAssignmentSubmission(input: {
  assignmentId: string;
  text: string;
  link: string;
  filePath: string;
  fileName: string;
  fileMimeType: string;
  fileSizeBytes: number | null;
  submitNow: boolean;
}) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_save_my_assignment_submission", {
    target_assignment_id: input.assignmentId,
    submission_text: input.text,
    submission_link: input.link,
    submission_file_path: input.filePath,
    submission_file_name: input.fileName,
    submission_file_mime_type: input.fileMimeType,
    submission_file_size_bytes: input.fileSizeBytes,
    submit_now: input.submitNow
  });
  if (error) throw error;
  return data as LearnerAssignmentSubmission;
}

export async function getMyAssignmentFileUrl(path: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.storage
    .from("adci-assignment-submissions")
    .createSignedUrl(path, 60 * 30);
  if (error) throw error;
  return data.signedUrl;
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
