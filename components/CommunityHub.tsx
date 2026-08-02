"use client";

import {
  Check,
  ChevronUp,
  CircleHelp,
  Clock3,
  Edit3,
  GraduationCap,
  LoaderCircle,
  Lock,
  MessageCircle,
  MessageSquarePlus,
  Pin,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  UsersRound,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  createDiscussion,
  deleteDiscussion,
  deleteDiscussionReply,
  getCommunityFeed,
  markDiscussionAnswer,
  replyToDiscussion,
  toggleDiscussionVote,
  updateDiscussion,
  type CommunityFeed,
  type DiscussionPost,
  type DiscussionReply
} from "../lib/supabase/community";

function relativeTime(value: string) {
  const seconds = Math.floor((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function roleLabel(role: string) {
  return role === "student" ? "Learner" : role.split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

export default function CommunityHub({
  close,
  notify
}: {
  close: () => void;
  notify: (message: string) => void;
}) {
  const [feed, setFeed] = useState<CommunityFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [courseFilter, setCourseFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selectedPost, setSelectedPost] = useState<DiscussionPost | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [category, setCategory] = useState<DiscussionPost["category"]>("course_question");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [replyBody, setReplyBody] = useState("");

  async function refresh(preferredPostId?: string) {
    setLoading(true);
    setError("");
    try {
      const result = await getCommunityFeed({ courseId: courseFilter, filter, search });
      setFeed(result);
      const postId = preferredPostId ?? selectedPost?.id;
      if (postId) setSelectedPost(result.posts.find((post) => post.id === postId) ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load community");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [filter, courseFilter]);

  const popularCourses = useMemo(() => (feed?.courses ?? []).map((course) => ({
    ...course,
    count: feed?.posts.filter((post) => post.course_id === course.id).length ?? 0
  })).sort((a, b) => b.count - a.count).slice(0, 4), [feed]);

  function openEditor(post?: DiscussionPost) {
    setEditingId(post?.id ?? "");
    setCourseId(post?.course_id ?? "");
    setCategory(post?.category ?? "course_question");
    setTitle(post?.title ?? "");
    setBody(post?.body ?? "");
    setEditorOpen(true);
    setError("");
  }

  async function saveDiscussion(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const savedId = editingId
        ? (await updateDiscussion(editingId, title, body), editingId)
        : await createDiscussion({ courseId, category, title, body });
      notify(editingId ? "Discussion updated" : "Discussion posted");
      setEditorOpen(false);
      await refresh(savedId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save discussion");
    } finally {
      setSaving(false);
    }
  }

  async function removePost(post: DiscussionPost) {
    if (!window.confirm(`Delete “${post.title}”?`)) return;
    setSaving(true);
    try {
      await deleteDiscussion(post.id);
      notify("Discussion deleted");
      setSelectedPost(null);
      await refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete discussion");
    } finally {
      setSaving(false);
    }
  }

  async function submitReply(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedPost) return;
    setSaving(true);
    setError("");
    try {
      await replyToDiscussion(selectedPost.id, replyBody);
      setReplyBody("");
      notify("Reply posted");
      await refresh(selectedPost.id);
    } catch (replyError) {
      setError(replyError instanceof Error ? replyError.message : "Unable to post reply");
    } finally {
      setSaving(false);
    }
  }

  async function vote(targetType: "post" | "reply", targetId: string) {
    try {
      await toggleDiscussionVote(targetType, targetId);
      await refresh(selectedPost?.id);
    } catch (voteError) {
      setError(voteError instanceof Error ? voteError.message : "Unable to update vote");
    }
  }

  async function acceptAnswer(reply: DiscussionReply) {
    if (!selectedPost) return;
    try {
      await markDiscussionAnswer(selectedPost.id, reply.id);
      notify("Answer marked as accepted");
      await refresh(selectedPost.id);
    } catch (answerError) {
      setError(answerError instanceof Error ? answerError.message : "Unable to accept answer");
    }
  }

  async function removeReply(reply: DiscussionReply) {
    if (!window.confirm("Delete this reply?")) return;
    try {
      await deleteDiscussionReply(reply.id);
      notify("Reply deleted");
      await refresh(selectedPost?.id);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete reply");
    }
  }

  return <div className="community-page">
    <header className="community-header">
      <span aria-hidden="true" />
      <div><p className="eyebrow">ADCI LEARNING COMMUNITY</p><h1>Community</h1></div>
      <button className="primary" onClick={() => openEditor()}><MessageSquarePlus /> Start discussion</button>
    </header>
    <main className="community-content">
      <section className="community-summary">
        <article><div><MessageCircle /></div><span>DISCUSSIONS</span><strong>{feed?.summary.discussions ?? 0}</strong></article>
        <article><div className="unanswered"><CircleHelp /></div><span>UNANSWERED</span><strong>{feed?.summary.unanswered ?? 0}</strong></article>
        <article><div className="resolved"><Check /></div><span>RESOLVED</span><strong>{feed?.summary.resolved ?? 0}</strong></article>
        <article><div className="mine"><UsersRound /></div><span>MY POSTS</span><strong>{feed?.summary.my_posts ?? 0}</strong></article>
      </section>
      <div className="community-layout">
        <section className="community-feed-card">
          <div className="community-filters">
            <form onSubmit={(event) => { event.preventDefault(); void refresh(); }}><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search discussions…" /><button><Search /> Search</button></form>
            <select value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}><option value="">All courses</option>{feed?.courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select>
          </div>
          <div className="community-tabs">{(["all", "mine", "unanswered", "resolved", "course_questions"] as const).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item.replace("_", " ")}</button>)}<button className="community-refresh" onClick={() => void refresh()}><RefreshCw className={loading ? "spin" : ""} /></button></div>
          {error && !selectedPost && !editorOpen && <div className="assignment-error">{error}<button onClick={() => void refresh()}>Retry</button></div>}
          <div className="community-post-list">
            {loading && !feed ? <div className="community-empty"><LoaderCircle className="spin" /> Loading discussions…</div>
            : (feed?.posts.length ?? 0) === 0 ? <div className="community-empty"><MessageCircle /><h3>No discussions found</h3><p>Start a conversation or adjust the selected filters.</p><button onClick={() => openEditor()}><MessageSquarePlus /> Start discussion</button></div>
            : feed?.posts.map((post) => <article key={post.id} className={`${post.pinned ? "pinned" : ""} ${post.status}`}>
              <button className={`community-vote ${post.voted ? "voted" : ""}`} onClick={() => void vote("post", post.id)}><ChevronUp /><strong>{post.vote_count}</strong><span>helpful</span></button>
              <button className="community-post-main" onClick={() => { setSelectedPost(post); setError(""); }}>
                <div className="community-post-labels">{post.pinned && <em><Pin /> Pinned</em>}<span>{post.course_title}</span><small>{post.category.replace("_", " ")}</small>{post.status !== "open" && <small className={post.status}>{post.status}</small>}</div>
                <h2>{post.title}</h2><p>{post.body}</p>
                <footer><span className="community-avatar">{post.author_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span><span><strong>{post.author_name}</strong><small>{roleLabel(post.author_role)} · {relativeTime(post.updated_at)}</small></span><em><MessageCircle /> {post.reply_count} repl{post.reply_count === 1 ? "y" : "ies"}</em></footer>
              </button>
            </article>)}
          </div>
        </section>
        <aside className="community-sidebar">
          <section><div><Sparkles /><h3>Community guidelines</h3></div><ul><li>Keep questions focused and clear.</li><li>Be respectful to every learner.</li><li>Use helpful votes for useful answers.</li><li>Never share private course files.</li></ul></section>
          <section><div><GraduationCap /><h3>Active course spaces</h3></div>{popularCourses.map((course) => <button key={course.id} onClick={() => setCourseFilter(course.id)}><span>{course.title.slice(0, 2).toUpperCase()}</span><div><strong>{course.title}</strong><small>{course.count} discussion{course.count === 1 ? "" : "s"}</small></div></button>)}</section>
        </aside>
      </div>
    </main>

    {editorOpen && <div className="course-dialog-backdrop"><form className="community-editor" onSubmit={saveDiscussion}>
      <header><div><p className="eyebrow">{editingId ? "EDIT DISCUSSION" : "NEW DISCUSSION"}</p><h2>{editingId ? "Update your post" : "Start a conversation"}</h2></div><button type="button" onClick={() => setEditorOpen(false)}><X /></button></header>
      {!editingId && <div className="community-editor-settings"><label><span>Course space</span><select value={courseId} onChange={(event) => setCourseId(event.target.value)}><option value="">General ADCI community</option>{feed?.courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label><label><span>Discussion type</span><select value={category} onChange={(event) => setCategory(event.target.value as typeof category)}><option value="course_question">Course question</option><option value="general">General discussion</option><option value="study_group">Study group</option></select></label></div>}
      <label><span>Title</span><input required minLength={3} maxLength={180} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What would you like to discuss?" /></label>
      <label><span>Details</span><textarea required minLength={3} maxLength={10000} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Add context so the community can give a useful answer…" /><small>{body.length}/10000</small></label>
      {error && <div className="assignment-error">{error}</div>}
      <footer><button type="button" onClick={() => setEditorOpen(false)}>Cancel</button><button className="primary" disabled={saving}>{saving ? <LoaderCircle className="spin" /> : <Send />} {editingId ? "Save changes" : "Post discussion"}</button></footer>
    </form></div>}

    {selectedPost && <div className="community-thread-backdrop"><section className="community-thread">
      <header><div><div className="community-post-labels">{selectedPost.pinned && <em><Pin /> Pinned</em>}<span>{selectedPost.course_title}</span><small>{selectedPost.category.replace("_", " ")}</small></div><h2>{selectedPost.title}</h2></div><button onClick={() => setSelectedPost(null)}><X /></button></header>
      <div className="community-thread-question"><div className="thread-author"><span>{selectedPost.author_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span><div><strong>{selectedPost.author_name}</strong><small>{roleLabel(selectedPost.author_role)} · {relativeTime(selectedPost.created_at)}</small></div>{selectedPost.is_author && <div><button onClick={() => { openEditor(selectedPost); setSelectedPost(null); }}><Edit3 /> Edit</button><button onClick={() => void removePost(selectedPost)}><Trash2 /> Delete</button></div>}</div><p>{selectedPost.body}</p><button className={selectedPost.voted ? "voted" : ""} onClick={() => void vote("post", selectedPost.id)}><ChevronUp /> Helpful · {selectedPost.vote_count}</button></div>
      <div className="community-replies-title"><h3>{selectedPost.reply_count} repl{selectedPost.reply_count === 1 ? "y" : "ies"}</h3>{selectedPost.status === "resolved" && <span><Check /> Resolved</span>}{selectedPost.status === "locked" && <span className="locked"><Lock /> Locked</span>}</div>
      <div className="community-replies">{selectedPost.replies.map((reply) => <article key={reply.id} className={reply.accepted ? "accepted" : ""}>
        <span className="community-avatar">{reply.author_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>
        <div><header><div><strong>{reply.author_name}</strong><small>{roleLabel(reply.author_role)} · {relativeTime(reply.created_at)}</small></div>{reply.accepted && <em><ShieldCheck /> Accepted answer</em>}</header><p>{reply.body}</p><footer><button className={reply.voted ? "voted" : ""} onClick={() => void vote("reply", reply.id)}><ChevronUp /> Helpful · {reply.vote_count}</button>{!reply.accepted && (selectedPost.is_author || selectedPost.can_moderate) && <button onClick={() => void acceptAnswer(reply)}><Check /> Accept answer</button>}{reply.is_author && <button className="delete" onClick={() => void removeReply(reply)}><Trash2 /> Delete</button>}</footer></div>
      </article>)}</div>
      {selectedPost.status !== "locked" && <form className="community-reply-form" onSubmit={submitReply}><span><MessageCircle /></span><textarea required maxLength={10000} value={replyBody} onChange={(event) => setReplyBody(event.target.value)} placeholder="Write a helpful reply…" /><button disabled={saving}>{saving ? <LoaderCircle className="spin" /> : <Send />} Reply</button></form>}
      {error && <div className="assignment-error">{error}</div>}
    </section></div>}
  </div>;
}
