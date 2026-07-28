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
  const projectId = new URL(projectUrl).hostname.split(".")[0];
  const extension = file.name.split(".").pop()?.toLowerCase() || "mp4";
  const objectPath = `${lessonId}/${crypto.randomUUID()}.${extension}`;

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${accessToken}`,
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
