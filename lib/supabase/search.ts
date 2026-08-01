import { getSupabaseBrowserClient } from "./client";

export type LearningSearchResult = {
  result_type: "course" | "lesson" | "quiz" | "assignment";
  id: string;
  course_id: string;
  lesson_id: string | null;
  title: string;
  subtitle: string;
  content_type: "course" | "video" | "audio" | "pdf" | "html" | "live" | "quiz" | "assignment";
};

export async function searchLearningContent(query: string, limit = 20) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("The learning service is not configured");
  const normalized = query.trim();
  if (normalized.length < 2) return [];
  const { data, error } = await supabase.rpc("adci_search_learning", {
    search_query: normalized,
    result_limit: Math.min(50, Math.max(1, limit))
  });
  if (error) throw error;
  return (data ?? []) as LearningSearchResult[];
}
