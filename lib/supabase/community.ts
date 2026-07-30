import { getSupabaseBrowserClient } from "./client";

export type DiscussionReply = {
  id: string;
  author_id: string;
  author_name: string;
  author_role: string;
  body: string;
  accepted: boolean;
  created_at: string;
  vote_count: number;
  voted: boolean;
  is_author: boolean;
};

export type DiscussionPost = {
  id: string;
  course_id: string | null;
  course_title: string;
  author_id: string;
  author_name: string;
  author_role: string;
  category: "general" | "course_question" | "study_group";
  title: string;
  body: string;
  status: "open" | "resolved" | "locked";
  pinned: boolean;
  created_at: string;
  updated_at: string;
  reply_count: number;
  vote_count: number;
  voted: boolean;
  is_author: boolean;
  can_moderate: boolean;
  replies: DiscussionReply[];
};

export type CommunityFeed = {
  summary: { discussions: number; unanswered: number; resolved: number; my_posts: number };
  courses: { id: string; title: string }[];
  posts: DiscussionPost[];
};

export type AdminDiscussionPost = {
  id: string;
  course_id: string | null;
  course_title: string;
  author_id: string;
  author_name: string;
  author_email: string;
  category: DiscussionPost["category"];
  title: string;
  body: string;
  status: "open" | "resolved" | "locked" | "hidden";
  pinned: boolean;
  created_at: string;
  updated_at: string;
  reply_count: number;
  vote_count: number;
};

export type AdminCommunityData = {
  summary: { total: number; open: number; unanswered: number; hidden: number };
  courses: { id: string; title: string }[];
  posts: AdminDiscussionPost[];
};

export async function getCommunityFeed(filters: { courseId?: string; filter?: string; search?: string } = {}) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_get_community_feed", {
    target_course_id: filters.courseId || null,
    target_filter: filters.filter ?? "all",
    target_search: filters.search || null
  });
  if (error) throw error;
  return data as CommunityFeed;
}

export async function createDiscussion(input: {
  courseId: string;
  category: DiscussionPost["category"];
  title: string;
  body: string;
}) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_create_discussion", {
    discussion_course_id: input.courseId || null,
    discussion_category: input.category,
    discussion_title: input.title,
    discussion_body: input.body
  });
  if (error) throw error;
  return data as string;
}

export async function updateDiscussion(postId: string, title: string, body: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.rpc("adci_update_my_discussion", {
    target_post_id: postId,
    discussion_title: title,
    discussion_body: body
  });
  if (error) throw error;
}

export async function deleteDiscussion(postId: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.rpc("adci_delete_my_discussion", { target_post_id: postId });
  if (error) throw error;
}

export async function replyToDiscussion(postId: string, body: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_reply_to_discussion", {
    target_post_id: postId,
    reply_body: body
  });
  if (error) throw error;
  return data as string;
}

export async function deleteDiscussionReply(replyId: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.rpc("adci_delete_my_discussion_reply", { target_reply_id: replyId });
  if (error) throw error;
}

export async function toggleDiscussionVote(targetType: "post" | "reply", targetId: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_toggle_discussion_vote", {
    vote_target_type: targetType,
    vote_target_id: targetId
  });
  if (error) throw error;
  return data as boolean;
}

export async function markDiscussionAnswer(postId: string, replyId: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.rpc("adci_mark_discussion_answer", {
    target_post_id: postId,
    target_reply_id: replyId
  });
  if (error) throw error;
}

export async function getAdminCommunity() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_admin_get_community");
  if (error) throw error;
  return data as AdminCommunityData;
}

export async function moderateDiscussion(
  postId: string,
  action: "pin" | "unpin" | "lock" | "unlock" | "resolve" | "reopen" | "hide" | "restore"
) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.rpc("adci_admin_moderate_discussion", {
    target_post_id: postId,
    moderation_action: action
  });
  if (error) throw error;
}
