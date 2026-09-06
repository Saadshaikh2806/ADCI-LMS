import { getSupabaseBrowserClient } from "./client";

const adminRoles = new Set([
  "instructor",
  "content_author",
  "academic_lead",
  "mentor",
  "branch_admin",
  "finance",
  "super_admin",
  "support"
]);

export type AdciMembership = {
  role: string;
  organization_id: string;
};

export type AdciCourse = {
  id: string;
  title: string;
  slug: string;
  description: string;
  status: string;
  updated_at: string;
};

export type AdciLesson = {
  id: string;
  title: string;
  lesson_type: "video" | "audio" | "pdf" | "html" | "live" | "quiz";
  position: number;
  duration_seconds: number;
  status: string;
  adci_lesson_assets: Array<{
    id: string;
    asset_type: string;
    storage_provider: string;
    original_name: string;
    size_bytes: number;
    object_path: string;
  }>;
  adci_video_assets: Array<{ object_path: string; storage_provider: string }>;
  adci_live_classes: AdciLiveClass[];
};

export type AdciModule = {
  id: string;
  title: string;
  position: number;
  adci_lessons: AdciLesson[];
};

export type AdciCourseEditor = AdciCourse & {
  adci_modules: AdciModule[];
};

export type AdciPerson = {
  user_id: string;
  full_name: string;
  email: string;
  role: string | null;
  active: boolean;
  created_at: string;
};

export type AdciLearningReport = {
  range_days: number;
  generated_at: string;
  summary: {
    active_learners: number;
    at_risk_learners: number;
    average_completion: number;
    average_accuracy: number;
    learning_hours: number;
    tests_completed: number;
    published_courses: number;
  };
  courses: Array<{
    course_id: string;
    title: string;
    slug: string;
    status: string;
    lesson_count: number;
    enrolled_learners: number;
    engaged_learners: number;
    average_progress: number;
    attempts_completed: number;
    accuracy_percent: number;
  }>;
  learners: Array<{
    learner_id: string;
    full_name: string;
    email: string;
    courses_enrolled: number;
    total_lessons: number;
    lessons_completed: number;
    progress_percent: number;
    learning_seconds: number;
    tests_completed: number;
    answered_questions: number;
    correct_answers: number;
    accuracy_percent: number;
    last_activity: string | null;
    engagement_status: "active" | "at_risk" | "not_started" | "nearly_complete";
  }>;
};

export async function getAdciLearningReport(days: number) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");

  const { data, error } = await supabase.rpc("adci_get_admin_learning_report", {
    target_days: days
  });
  if (error) throw error;
  return data as AdciLearningReport;
}

export type AdciAuditEvent = {
  id: number;
  actor_id: string | null;
  actor_name: string;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
};

export type AdciAuditLog = {
  total: number;
  limit: number;
  offset: number;
  summary: { today: number; actors: number; access_changes: number; content_changes: number };
  actions: string[];
  entity_types: string[];
  events: AdciAuditEvent[];
};

export type AdciAuditFilters = {
  limit?: number;
  offset?: number;
  action?: string;
  entityType?: string;
  from?: string;
  to?: string;
  search?: string;
};

export async function getAdciAuditLog(filters: AdciAuditFilters = {}) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_admin_get_audit_log", {
    target_limit: filters.limit ?? 25,
    target_offset: filters.offset ?? 0,
    target_action: filters.action || null,
    target_entity_type: filters.entityType || null,
    target_from: filters.from || null,
    target_to: filters.to || null,
    target_search: filters.search || null
  });
  if (error) throw error;
  return data as AdciAuditLog;
}

export type AdciAdminDashboard = {
  summary: {
    active_learners: number;
    live_attendance_today: number;
    course_completion: number;
    at_risk_learners: number;
    published_courses: number;
  };
  engagement: Array<{ date: string; label: string; enrolments: number; activity: number }>;
  engagement_summary: { new_enrolments: number; learning_sessions: number; average_study_minutes: number };
  attention: {
    at_risk_learners: number;
    courses_in_review: number;
    unscheduled_live_lessons: number;
    empty_quizzes: number;
  };
  course_health: Array<{
    course_id: string;
    title: string;
    status: string;
    lesson_count: number;
    enrolled_learners: number;
    completion_percent: number;
    engaged_learners: number;
  }>;
  upcoming_classes: Array<{
    lesson_id: string;
    title: string;
    course_title: string;
    instructor_name: string;
    provider: string;
    starts_at: string;
    attendance_count: number;
  }>;
  recent_activity: Array<{
    id: number;
    action: string;
    entity_type: string;
    actor_name: string;
    created_at: string;
  }>;
};

export async function getAdciAdminDashboard() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_get_admin_dashboard");
  if (error) throw error;
  return data as AdciAdminDashboard;
}

export type AdciAnnouncement = {
  id: string;
  title: string;
  body: string;
  audience: "all" | "learners" | "staff";
  priority: "info" | "important" | "urgent";
  status: "draft" | "published" | "retired";
  published_at: string | null;
  expires_at: string | null;
  created_at: string;
  read_count: number;
  recipient_count: number;
};

export type AdciAnnouncementAdminData = {
  summary: { total: number; published: number; drafts: number; urgent: number };
  announcements: AdciAnnouncement[];
};

export async function getAdciAnnouncements() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_admin_get_announcements");
  if (error) throw error;
  return data as AdciAnnouncementAdminData;
}

export async function saveAdciAnnouncement(input: {
  id?: string;
  title: string;
  body: string;
  audience: AdciAnnouncement["audience"];
  priority: AdciAnnouncement["priority"];
  status: AdciAnnouncement["status"];
  publishedAt: string | null;
  expiresAt: string | null;
}) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_admin_save_announcement", {
    target_announcement_id: input.id ?? null,
    announcement_title: input.title,
    announcement_body: input.body,
    announcement_audience: input.audience,
    announcement_priority: input.priority,
    announcement_status: input.status,
    announcement_published_at: input.publishedAt,
    announcement_expires_at: input.expiresAt
  });
  if (error) throw error;
  return data as string;
}

export async function deleteAdciAnnouncement(announcementId: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.rpc("adci_admin_delete_announcement", {
    target_announcement_id: announcementId
  });
  if (error) throw error;
}

export type AdciAssignment = {
  id: string;
  course_id: string;
  course_title: string;
  title: string;
  instructions: string;
  submission_type: "file" | "text" | "link" | "mixed";
  max_score: number;
  available_from: string | null;
  due_at: string | null;
  status: "draft" | "in_review" | "approved" | "published" | "retired";
  allowed_mime_types: string[];
  max_file_bytes: number;
  created_at: string;
  submission_count: number;
  awaiting_review_count: number;
  graded_count: number;
  learner_count: number;
};

export type AdciAssignmentAdminData = {
  summary: { total: number; published: number; awaiting_review: number; graded: number };
  courses: { id: string; title: string; status: string }[];
  assignments: AdciAssignment[];
};

export type AdciAssignmentSubmission = {
  learner_id: string;
  learner_name: string;
  learner_email: string;
  submission_id: string | null;
  text_response: string | null;
  link_url: string | null;
  file_path: string | null;
  file_name: string | null;
  file_mime_type: string | null;
  file_size_bytes: number | null;
  status: "not_submitted" | "draft" | "submitted" | "graded" | "returned";
  submitted_at: string | null;
  score: number | null;
  feedback: string | null;
  graded_at: string | null;
};

export type AdciAssignmentSubmissionsData = {
  assignment: { id: string; title: string; max_score: number; due_at: string | null };
  submissions: AdciAssignmentSubmission[];
};

export async function getAdciAssignments() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_admin_get_assignments");
  if (error) throw error;
  return data as AdciAssignmentAdminData;
}

export async function saveAdciAssignment(input: {
  id?: string;
  courseId: string;
  title: string;
  instructions: string;
  submissionType: AdciAssignment["submission_type"];
  maxScore: number;
  availableFrom: string | null;
  dueAt: string | null;
  status: AdciAssignment["status"];
}) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_admin_save_assignment", {
    target_assignment_id: input.id ?? null,
    target_course_id: input.courseId,
    assignment_title: input.title,
    assignment_instructions: input.instructions,
    assignment_submission_type: input.submissionType,
    assignment_max_score: input.maxScore,
    assignment_available_from: input.availableFrom,
    assignment_due_at: input.dueAt,
    assignment_status: input.status
  });
  if (error) throw error;
  return data as string;
}

export async function archiveAdciAssignment(assignmentId: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_admin_archive_assignment", {
    target_assignment_id: assignmentId
  });
  if (error) throw error;
  return data as "deleted" | "archived";
}

export async function getAdciAssignmentSubmissions(assignmentId: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_admin_get_assignment_submissions", {
    target_assignment_id: assignmentId
  });
  if (error) throw error;
  return data as AdciAssignmentSubmissionsData;
}

export async function gradeAdciAssignmentSubmission(
  submissionId: string,
  score: number | null,
  feedback: string,
  decision: "graded" | "returned"
) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.rpc("adci_admin_grade_assignment_submission", {
    target_submission_id: submissionId,
    awarded_score: score,
    teacher_feedback: feedback,
    grading_decision: decision
  });
  if (error) throw error;
}

export async function getAdciSubmissionFileUrl(path: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.storage
    .from("adci-assignment-submissions")
    .createSignedUrl(path, 60 * 30);
  if (error) throw error;
  return data.signedUrl;
}

export async function listAdciPeople() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return [];

  const { data, error } = await supabase.rpc("adci_admin_list_people");
  if (error) throw error;
  return (data ?? []) as AdciPerson[];
}

export async function setAdciUserRole(userId: string, role: string, active: boolean) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");

  const { data, error } = await supabase.rpc("adci_admin_set_user_role", {
    target_user_id: userId,
    new_role: role,
    membership_active: active
  });

  if (error) throw error;
  return data;
}

export async function loadMyAdciMemberships() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("adci_memberships")
    .select("role,organization_id")
    .eq("active", true);

  if (error) throw error;
  return (data ?? []) as AdciMembership[];
}

export function hasAcademicAdminRole(memberships: AdciMembership[]) {
  return memberships.some((membership) => adminRoles.has(membership.role));
}

type LiveSessionProbeLesson = { lesson_type?: string | null };
type LiveSessionProbeModule = { adci_lessons?: LiveSessionProbeLesson[] | null };
type LiveSessionProbeCourse = { slug: string; adci_modules?: LiveSessionProbeModule[] | null };

// adci_create_bookable_live_series generates one standalone course per session
// occurrence with a slug of "<title>-<YYYY-MM-DD>-<first 8 hex of the series id>".
// These are created and managed entirely from the Live Classes tab and must
// never appear or open in Academics. Their adci_live_classes rows (and the
// series_id on them) get pruned once the session passes or a purchase is
// cancelled, so the slug is the only durable signal. Course slugs created any
// other way come from the title alone and never carry a trailing date + hex id.
const BOOKABLE_LIVE_SESSION_SLUG = /-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/;

function isBookableLiveSessionCourse(course: LiveSessionProbeCourse) {
  if (!BOOKABLE_LIVE_SESSION_SLUG.test(course.slug)) return false;
  // Guard against a real course that happens to reuse that slug shape: if it
  // carries any non-live lesson it is genuine content and stays in Academics.
  const lessons = (course.adci_modules ?? []).flatMap((module) => module.adci_lessons ?? []);
  return lessons.every((lesson) => lesson.lesson_type === "live");
}

export async function listAdciCourses() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("adci_courses")
    .select("id,title,slug,description,status,updated_at,adci_modules(adci_lessons(lesson_type))")
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return (data ?? [])
    .filter((course) => !isBookableLiveSessionCourse(course))
    .map(({ adci_modules: _modules, ...course }) => course) as AdciCourse[];
}

export async function getAdciCourseEditor(courseId: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");

  const { data, error } = await supabase
    .from("adci_courses")
    .select("id,title,slug,description,status,updated_at,adci_modules(id,title,position,adci_lessons(id,title,lesson_type,position,duration_seconds,status,adci_lesson_assets(id,asset_type,storage_provider,original_name,size_bytes,object_path),adci_video_assets(storage_provider,object_path),adci_live_classes(provider,meeting_url,instructor_name,starts_at,ends_at)))")
    .eq("id", courseId)
    .order("position", { referencedTable: "adci_modules", ascending: true })
    .order("position", { referencedTable: "adci_modules.adci_lessons", ascending: true })
    .single();

  if (error) throw error;
  if (data && isBookableLiveSessionCourse(data)) {
    throw new Error("This live session is managed from the Live Classes tab, not Academics.");
  }
  return data as AdciCourseEditor;
}

export async function updateAdciCourse(courseId: string, title: string, description: string, status: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_update_course", {
    target_course_id: courseId,
    course_title: title,
    course_description: description,
    course_status: status
  });
  if (error) throw error;
  return data;
}

export async function addAdciCourseModule(courseId: string, title: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_add_course_module", {
    target_course_id: courseId,
    module_title: title
  });
  if (error) throw error;
  return data;
}

export async function addAdciModuleLesson(moduleId: string, title: string, type: AdciLesson["lesson_type"], durationSeconds: number) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_add_module_lesson", {
    target_module_id: moduleId,
    lesson_title: title,
    lesson_kind: type,
    lesson_duration_seconds: durationSeconds
  });
  if (error) throw error;
  return data as AdciLesson;
}

export type CourseBundleInput = {
  courseTitle: string;
  slug: string;
  description: string;
  moduleTitle: string;
  lessonTitle: string;
  lessonType: "video" | "audio" | "pdf" | "html" | "live" | "quiz";
  durationSeconds: number;
};

export async function createCourseBundle(input: CourseBundleInput) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");

  const { data, error } = await supabase.rpc("adci_create_course_bundle", {
    course_title: input.courseTitle,
    course_slug: input.slug,
    course_description: input.description,
    module_title: input.moduleTitle,
    lesson_title: input.lessonTitle,
    lesson_kind: input.lessonType,
    lesson_duration_seconds: input.durationSeconds
  });

  if (error) throw error;
  return data as { course_id: string; module_id: string; lesson_id: string };
}

async function uploadFileToR2(
  lessonId: string,
  file: File,
  assetType: "video" | "audio" | "pdf",
  onProgress: (percentage: number) => void
) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("Authentication required");

  const prepareResponse = await fetch("/api/storage/r2-upload-url", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ lessonId, fileName: file.name, contentType: file.type, fileSize: file.size, assetType })
  });
  const prepared = await prepareResponse.json() as { uploadUrl?: string; objectPath?: string; error?: string };
  if (!prepareResponse.ok || !prepared.uploadUrl || !prepared.objectPath) {
    throw new Error(prepared.error || "Unable to prepare upload");
  }

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", prepared.uploadUrl as string, true);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("Upload failed")));
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(file);
  });

  return prepared.objectPath;
}

async function deleteFilesFromR2(objects: Array<{ lessonId: string; objectPath: string }>) {
  if (objects.length === 0) return;
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("Authentication required");

  const response = await fetch("/api/storage/r2-delete-objects", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ objects })
  });
  const result = await response.json() as { deleted?: number; error?: string };
  if (!response.ok) throw new Error(result.error || "Unable to delete protected files from Cloudflare R2");
}

export async function uploadProtectedLessonVideo(
  lessonId: string,
  file: File,
  durationSeconds: number,
  onProgress: (percentage: number) => void
) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");

  const objectPath = await uploadFileToR2(lessonId, file, "video", onProgress);

  const { error } = await supabase.from("adci_video_assets").insert({
    lesson_id: lessonId,
    storage_provider: "r2",
    object_path: objectPath,
    mime_type: file.type || "video/mp4",
    size_bytes: file.size,
    duration_seconds: durationSeconds,
    processing_status: "ready"
  });

  if (error) {
    await deleteFilesFromR2([{ lessonId, objectPath }]).catch(() => undefined);
    throw error;
  }
  return objectPath;
}

export async function uploadProtectedLessonAsset(
  lessonId: string,
  assetType: "video" | "audio" | "pdf",
  file: File,
  onProgress: (percentage: number) => void
) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");

  const objectPath = await uploadFileToR2(lessonId, file, assetType, onProgress);

  const { error } = await supabase.from("adci_lesson_assets").insert({
    lesson_id: lessonId,
    asset_type: assetType,
    storage_provider: "r2",
    object_path: objectPath,
    original_name: file.name,
    mime_type: file.type || "application/octet-stream",
    size_bytes: file.size
  });

  if (error) {
    await deleteFilesFromR2([{ lessonId, objectPath }]).catch(() => undefined);
    throw error;
  }
  return objectPath;
}

export async function deleteAdciAcademicEntity(
  kind: "course" | "module" | "lesson",
  id: string,
  lessons: AdciLesson[]
) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");

  const r2Objects = lessons.flatMap((lesson) => [
    ...(lesson.adci_lesson_assets ?? [])
      .filter((asset) => asset.storage_provider === "r2")
      .map((asset) => ({ lessonId: lesson.id, objectPath: asset.object_path })),
    ...(lesson.adci_video_assets ?? [])
      .filter((asset) => asset.storage_provider === "r2")
      .map((asset) => ({ lessonId: lesson.id, objectPath: asset.object_path }))
  ]);
  const lessonAssets = lessons.flatMap((lesson) =>
    (lesson.adci_lesson_assets ?? [])
      .filter((asset) => asset.storage_provider !== "r2")
      .map((asset) => asset.object_path)
  );
  const legacyVideos = lessons.flatMap((lesson) =>
    (lesson.adci_video_assets ?? [])
      .filter((asset) => asset.storage_provider !== "r2")
      .map((asset) => asset.object_path)
  );

  await deleteFilesFromR2(r2Objects);
  if (lessonAssets.length) {
    const { error } = await supabase.storage.from("adci-lesson-assets").remove(lessonAssets);
    if (error) throw error;
  }
  if (legacyVideos.length) {
    const { error } = await supabase.storage.from("adci-course-videos").remove(legacyVideos);
    if (error) throw error;
  }

  const { error } = await supabase.rpc("adci_delete_academic_entity", {
    entity_kind: kind,
    target_id: id
  });
  if (error) throw error;
}

export type AdciQuizEditor = {
  id: string;
  lesson_id: string;
  title: string;
  duration_seconds: number;
  positive_marks: number;
  negative_marks: number;
  pass_percent: number;
  status: string;
  adci_assessment_questions: Array<{
    position: number;
    adci_questions: {
      id: string;
      prompt: string;
      options: string[];
      correct_answer: { index: number };
      explanation: string | null;
    };
  }>;
};

export async function getAdciQuizEditor(lessonId: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase
    .from("adci_assessments")
    .select("id,lesson_id,title,duration_seconds,positive_marks,negative_marks,pass_percent,status,adci_assessment_questions(position,adci_questions(id,prompt,options,correct_answer,explanation))")
    .eq("lesson_id", lessonId)
    .order("position", { referencedTable: "adci_assessment_questions", ascending: true })
    .maybeSingle();
  if (error) throw error;
  return data as AdciQuizEditor | null;
}

export async function saveAdciQuiz(input: {
  lessonId: string;
  title: string;
  durationSeconds: number;
  positiveMarks: number;
  negativeMarks: number;
  passPercent: number;
  status: string;
}) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_save_quiz", {
    target_lesson_id: input.lessonId,
    quiz_title: input.title,
    quiz_duration_seconds: input.durationSeconds,
    quiz_positive_marks: input.positiveMarks,
    quiz_negative_marks: input.negativeMarks,
    quiz_pass_percent: input.passPercent,
    quiz_status: input.status
  });
  if (error) throw error;
  return data as { id: string };
}

export async function addAdciQuizQuestion(
  assessmentId: string,
  prompt: string,
  options: string[],
  correctOption: number,
  explanation: string
) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.rpc("adci_add_quiz_question", {
    target_assessment_id: assessmentId,
    question_prompt: prompt,
    question_options: options,
    correct_option: correctOption,
    question_explanation: explanation
  });
  if (error) throw error;
}

export async function deleteAdciQuizQuestion(assessmentId: string, questionId: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.rpc("adci_delete_quiz_question", {
    target_assessment_id: assessmentId,
    target_question_id: questionId
  });
  if (error) throw error;
}

export type AdciBankQuestion = {
  id: string;
  prompt: string;
  options: string[];
  correct_option: number;
  explanation: string;
  topic: string;
  difficulty: "easy" | "medium" | "hard";
  version: number;
  created_at: string;
  usage_count: number;
  locked: boolean;
  assessments: Array<{ id: string; title: string }>;
};

export type AdciQuestionBank = {
  summary: { total: number; used: number; unused: number; topics: number };
  questions: AdciBankQuestion[];
  assessments: Array<{
    id: string;
    title: string;
    status: string;
    course_title: string;
    question_count: number;
  }>;
};

export async function getAdciQuestionBank() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_admin_get_question_bank");
  if (error) throw error;
  return data as AdciQuestionBank;
}

export async function saveAdciBankQuestion(input: {
  id?: string;
  prompt: string;
  options: string[];
  correctOption: number;
  explanation: string;
  topic: string;
  difficulty: "easy" | "medium" | "hard";
}) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_admin_save_bank_question", {
    target_question_id: input.id ?? null,
    question_prompt: input.prompt,
    question_options: input.options,
    correct_option: input.correctOption,
    question_explanation: input.explanation,
    question_topic: input.topic,
    question_difficulty: input.difficulty
  });
  if (error) throw error;
  return data as string;
}

export async function attachAdciBankQuestion(questionId: string, assessmentId: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.rpc("adci_admin_attach_bank_question", {
    target_question_id: questionId,
    target_assessment_id: assessmentId
  });
  if (error) throw error;
}

export async function deleteAdciBankQuestion(questionId: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.rpc("adci_admin_delete_bank_question", {
    target_question_id: questionId
  });
  if (error) throw error;
}

export async function getAdciArticle(lessonId: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.from("adci_article_contents").select("body,updated_at").eq("lesson_id", lessonId).maybeSingle();
  if (error) throw error;
  return data as { body: string; updated_at: string } | null;
}

export async function saveAdciArticle(lessonId: string, body: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.rpc("adci_save_article", { target_lesson_id: lessonId, article_body: body });
  if (error) throw error;
}

export type AdciLiveClass = {
  provider: "agora" | "zoom" | "youtube_live";
  meeting_url: string;
  instructor_name: string;
  starts_at: string;
  ends_at: string;
};

export async function getAdciLiveClass(lessonId: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.from("adci_live_classes").select("provider,meeting_url,instructor_name,starts_at,ends_at").eq("lesson_id", lessonId).maybeSingle();
  if (error) throw error;
  return data as AdciLiveClass | null;
}

export async function saveAdciLiveClass(lessonId: string, liveClass: AdciLiveClass) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.rpc("adci_save_live_class", {
    target_lesson_id: lessonId,
    class_provider: liveClass.provider,
    class_url: liveClass.meeting_url,
    class_instructor: liveClass.instructor_name,
    class_starts_at: liveClass.starts_at,
    class_ends_at: liveClass.ends_at
  });
  if (error) throw new Error(error.message || "Unable to save live class");
}

export async function saveAdciDailyLiveClasses(lessonId: string, liveClass: AdciLiveClass, repeatUntil: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_schedule_daily_live_classes", {
    target_lesson_id: lessonId,
    class_provider: liveClass.provider,
    class_url: liveClass.meeting_url,
    class_instructor: liveClass.instructor_name,
    class_starts_at: liveClass.starts_at,
    class_ends_at: liveClass.ends_at,
    repeat_until: repeatUntil
  });
  if (error) throw new Error(error.message || "Unable to schedule daily live classes");
  return data as { series_id: string; classes_created: number };
}

export type AdciScheduledLiveClass = AdciLiveClass & {
  lesson_id: string;
  lesson_title: string;
  module_title: string;
  course_id: string;
  course_title: string;
  course_status: string;
  offer_id: string | null;
  status: "live" | "scheduled" | "ended";
  attendance_count: number;
  total_joins: number;
};

export async function createAdciBookableLiveSeries(input: {
  provider: "agora" | "zoom";
  title: string;
  description: string;
  instructor: string;
  startsAt: string;
  durationMinutes: number;
  recurrence: "once" | "weekly";
  repeatUntil: string;
  pricePaise: number;
  gstRate: number;
}) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("Authentication required");

  const response = await fetch("/api/live-sessions/create-series", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(input)
  });
  const result = await response.json() as { classes_created?: number; error?: string };
  if (!response.ok) throw new Error(result.error || "Unable to create live sessions");
  return result as { series_id: string; classes_created: number };
}

export type AdciUnscheduledLiveLesson = {
  lesson_id: string;
  lesson_title: string;
  module_title: string;
  course_id: string;
  course_title: string;
  course_status: string;
};

export type AdciLiveSchedule = {
  summary: { scheduled: number; live_now: number; attendance: number; unscheduled: number };
  classes: AdciScheduledLiveClass[];
  unscheduled_lessons: AdciUnscheduledLiveLesson[];
};

export type AdciLiveAttendee = {
  learner_id: string;
  full_name: string;
  email: string;
  joined_at: string | null;
  last_joined_at: string | null;
  join_count: number;
};

export async function getAdciAdminLiveSchedule(days: number) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_admin_get_live_schedule", { target_days: days });
  if (error) throw error;
  return data as AdciLiveSchedule;
}

export async function getAdciLiveAttendance(lessonId: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_admin_get_live_attendance", { target_lesson_id: lessonId });
  if (error) throw error;
  return (data ?? []) as AdciLiveAttendee[];
}

export async function getAdciLiveDeleteDetails(lessonId: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_admin_live_delete_details", { target_lesson_id: lessonId });
  if (error) throw error;
  return data as { purchased_learners: number };
}

export async function deleteAdciLiveSchedule(lessonId: string, purchasedLearners: number) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.rpc("adci_admin_delete_live_schedule", {
    target_lesson_id: lessonId, confirmed_purchased_learners: purchasedLearners
  });
  if (error) throw error;
}

export type AdciCourseEnrolment = {
  course_id: string;
  title: string;
  status: string;
  enrolment_status: "pending" | "active" | "frozen" | "completed" | "cancelled" | null;
  access_expires_at: string | null;
  enrolled_at: string | null;
};

export async function getAdciUserEnrolments(userId: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_admin_get_user_enrolments", { target_user_id: userId });
  if (error) throw error;
  return (data ?? []) as AdciCourseEnrolment[];
}

export async function setAdciCourseEnrolment(
  userId: string,
  courseId: string,
  status: NonNullable<AdciCourseEnrolment["enrolment_status"]>,
  expiresAt: string | null
) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.rpc("adci_admin_set_course_enrolment", {
    target_user_id: userId,
    target_course_id: courseId,
    target_status: status,
    target_access_expires_at: expiresAt
  });
  if (error) throw error;
}
