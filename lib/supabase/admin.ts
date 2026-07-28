import * as tus from "tus-js-client";
import { getSupabaseBrowserClient } from "./client";

const adminRoles = new Set(["content_author", "academic_lead", "branch_admin", "super_admin"]);

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
    original_name: string;
    size_bytes: number;
    object_path: string;
  }>;
  adci_video_assets: Array<{ object_path: string }>;
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

export async function listAdciCourses() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("adci_courses")
    .select("id,title,slug,description,status,updated_at")
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as AdciCourse[];
}

export async function getAdciCourseEditor(courseId: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");

  const { data, error } = await supabase
    .from("adci_courses")
    .select("id,title,slug,description,status,updated_at,adci_modules(id,title,position,adci_lessons(id,title,lesson_type,position,duration_seconds,status,adci_lesson_assets(id,asset_type,original_name,size_bytes,object_path),adci_video_assets(object_path)))")
    .eq("id", courseId)
    .order("position", { referencedTable: "adci_modules", ascending: true })
    .order("position", { referencedTable: "adci_modules.adci_lessons", ascending: true })
    .single();

  if (error) throw error;
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

export async function uploadProtectedLessonVideo(
  lessonId: string,
  file: File,
  onProgress: (percentage: number) => void
) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("Authentication required");

  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!projectUrl) throw new Error("Supabase project URL is missing");
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!publishableKey) throw new Error("Supabase publishable key is missing");
  const projectId = new URL(projectUrl).hostname.split(".")[0];
  const extension = file.name.split(".").pop()?.toLowerCase() || "mp4";
  const objectPath = `${lessonId}/${crypto.randomUUID()}.${extension}`;

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${accessToken}`,
        apikey: publishableKey,
        "x-upsert": "false"
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      metadata: {
        bucketName: "adci-course-videos",
        objectName: objectPath,
        contentType: file.type || "video/mp4",
        cacheControl: "3600"
      },
      onError: reject,
      onProgress: (uploaded, total) => onProgress(Math.round((uploaded / total) * 100)),
      onSuccess: () => resolve()
    });
    upload.start();
  });

  const { error } = await supabase.from("adci_video_assets").insert({
    lesson_id: lessonId,
    object_path: objectPath,
    mime_type: file.type || "video/mp4",
    size_bytes: file.size,
    processing_status: "ready"
  });

  if (error) throw error;
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

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("Authentication required");

  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!projectUrl) throw new Error("Supabase project URL is missing");
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!publishableKey) throw new Error("Supabase publishable key is missing");
  const projectId = new URL(projectUrl).hostname.split(".")[0];
  const extension = file.name.split(".").pop()?.toLowerCase() || assetType;
  const objectPath = `${lessonId}/${crypto.randomUUID()}.${extension}`;

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${accessToken}`,
        apikey: publishableKey,
        "x-upsert": "false"
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      metadata: {
        bucketName: "adci-lesson-assets",
        objectName: objectPath,
        contentType: file.type || "application/octet-stream",
        cacheControl: "3600"
      },
      onError: reject,
      onProgress: (uploaded, total) => onProgress(Math.round((uploaded / total) * 100)),
      onSuccess: () => resolve()
    });
    upload.start();
  });

  const { error } = await supabase.from("adci_lesson_assets").insert({
    lesson_id: lessonId,
    asset_type: assetType,
    object_path: objectPath,
    original_name: file.name,
    mime_type: file.type || "application/octet-stream",
    size_bytes: file.size
  });

  if (error) throw error;
  return objectPath;
}

export async function deleteAdciAcademicEntity(
  kind: "course" | "module" | "lesson",
  id: string,
  lessons: AdciLesson[]
) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");

  const lessonAssets = lessons.flatMap((lesson) =>
    (lesson.adci_lesson_assets ?? []).map((asset) => asset.object_path)
  );
  const legacyVideos = lessons.flatMap((lesson) =>
    (lesson.adci_video_assets ?? []).map((asset) => asset.object_path)
  );

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
  provider: "zoom" | "google_meet" | "youtube_live";
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
  if (error) throw error;
}
