"use client";

import {
  Check,
  CircleHelp,
  Eye,
  EyeOff,
  LoaderCircle,
  Lock,
  MessageCircle,
  Pin,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Unlock,
  UsersRound,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  getAdminCommunity,
  moderateDiscussion,
  type AdminCommunityData,
  type AdminDiscussionPost
} from "../lib/supabase/community";

function relativeTime(value: string) {
  const hours = Math.floor((Date.now() - new Date(value).getTime()) / 3600000);
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  if (hours < 168) return `${Math.floor(hours / 24)}d ago`;
  return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function AdminCommunity({ notify }: { notify: (message: string) => void }) {
  const [data, setData] = useState<AdminCommunityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<AdminDiscussionPost | null>(null);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const result = await getAdminCommunity();
      setData(result);
      if (selected) setSelected(result.posts.find((post) => post.id === selected.id) ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load community moderation");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const posts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.posts ?? []).filter((post) =>
      (!query || post.title.toLowerCase().includes(query) || post.body.toLowerCase().includes(query)
        || post.author_name.toLowerCase().includes(query) || post.author_email.toLowerCase().includes(query))
      && (courseFilter === "all" || post.course_id === courseFilter)
      && (statusFilter === "all"
        || post.status === statusFilter
        || (statusFilter === "pinned" && post.pinned)
        || (statusFilter === "unanswered" && post.reply_count === 0 && post.status === "open"))
    );
  }, [data, search, courseFilter, statusFilter]);

  async function moderate(post: AdminDiscussionPost, action: "pin" | "unpin" | "lock" | "unlock" | "resolve" | "reopen" | "hide" | "restore") {
    if (action === "hide" && !window.confirm(`Hide “${post.title}” from the community?`)) return;
    setSaving(true);
    setError("");
    try {
      await moderateDiscussion(post.id, action);
      const actionLabels = {
        pin: "pinned",
        unpin: "unpinned",
        lock: "locked",
        unlock: "unlocked",
        resolve: "resolved",
        reopen: "reopened",
        hide: "hidden",
        restore: "restored"
      };
      notify(`Discussion ${actionLabels[action]}`);
      await refresh();
    } catch (moderationError) {
      setError(moderationError instanceof Error ? moderationError.message : "Unable to moderate discussion");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) return <div className="admin-report-state"><LoaderCircle className="spin" /><span>Loading community moderation…</span></div>;
  if (error && !data) return <div className="admin-report-state error"><UsersRound /><h2>Community unavailable</h2><p>{error}</p><button onClick={() => void refresh()}><RefreshCw /> Retry</button></div>;

  return <div className="admin-content admin-community-workspace">
    <div className="admin-welcome community-admin-heading"><div><h2>Community moderation</h2><p>Keep course discussions useful, respectful, and organised.</p></div><button onClick={() => void refresh()}><RefreshCw className={loading ? "spin" : ""} /> Refresh</button></div>
    {error && !selected && <div className="course-error">{error}</div>}
    <section className="community-admin-metrics">
      <article><div><MessageCircle /></div><span>VISIBLE POSTS</span><strong>{data?.summary.total ?? 0}</strong></article>
      <article><div className="open"><UsersRound /></div><span>OPEN</span><strong>{data?.summary.open ?? 0}</strong></article>
      <article><div className="unanswered"><CircleHelp /></div><span>UNANSWERED</span><strong>{data?.summary.unanswered ?? 0}</strong></article>
      <article><div className="hidden"><EyeOff /></div><span>HIDDEN</span><strong>{data?.summary.hidden ?? 0}</strong></article>
    </section>
    <section className="community-admin-card">
      <div className="community-admin-filters">
        <div><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search posts or authors…" /></div>
        <select value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}><option value="all">All course spaces</option>{data?.courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All moderation states</option><option value="open">Open</option><option value="unanswered">Unanswered</option><option value="resolved">Resolved</option><option value="locked">Locked</option><option value="pinned">Pinned</option><option value="hidden">Hidden</option></select>
      </div>
      <div className="community-admin-list">
        {posts.map((post) => <article key={post.id} className={`${post.pinned ? "pinned" : ""} ${post.status}`}>
          <div className="community-admin-author"><span>{post.author_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span><div><strong>{post.author_name}</strong><small>{post.author_email}</small></div></div>
          <div className="community-admin-copy"><div>{post.pinned && <em><Pin /> Pinned</em>}<span>{post.course_title}</span><small>{post.category.replace("_", " ")}</small></div><h3>{post.title}</h3><p>{post.body}</p></div>
          <div className="community-admin-engagement"><span><MessageCircle />{post.reply_count}<small>Replies</small></span><span><Check />{post.vote_count}<small>Helpful</small></span></div>
          <div className="community-admin-state"><em className={post.status}>{post.status}</em><small>{relativeTime(post.updated_at)}</small></div>
          <div className="community-admin-actions"><button onClick={() => setSelected(post)} title="View"><Eye /></button><button onClick={() => void moderate(post, post.pinned ? "unpin" : "pin")} title={post.pinned ? "Unpin" : "Pin"}><Pin /></button><button onClick={() => void moderate(post, post.status === "locked" ? "unlock" : "lock")} title={post.status === "locked" ? "Unlock" : "Lock"}>{post.status === "locked" ? <Unlock /> : <Lock />}</button>{post.status === "hidden" ? <button className="restore" onClick={() => void moderate(post, "restore")} title="Restore"><RotateCcw /></button> : <button className="hide" onClick={() => void moderate(post, "hide")} title="Hide"><EyeOff /></button>}</div>
        </article>)}
        {posts.length === 0 && <div className="report-empty"><MessageCircle /> No discussions match these filters.</div>}
      </div>
    </section>

    {selected && <div className="course-dialog-backdrop"><section className="community-moderation-dialog">
      <header><div><p className="eyebrow">MODERATION REVIEW</p><h2>{selected.title}</h2></div><button onClick={() => setSelected(null)}><X /></button></header>
      <div className="moderation-meta"><span>{selected.course_title}</span><span>{selected.category.replace("_", " ")}</span><span>{selected.reply_count} replies</span><span>{selected.vote_count} helpful votes</span></div>
      <div className="moderation-author"><span>{selected.author_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span><div><strong>{selected.author_name}</strong><small>{selected.author_email} · {new Date(selected.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</small></div></div>
      <p className="moderation-body">{selected.body}</p>
      {error && <div className="course-error">{error}</div>}
      <footer><button onClick={() => void moderate(selected, selected.pinned ? "unpin" : "pin")}><Pin />{selected.pinned ? "Unpin" : "Pin"}</button><button onClick={() => void moderate(selected, selected.status === "locked" ? "unlock" : "lock")}>{selected.status === "locked" ? <Unlock /> : <Lock />}{selected.status === "locked" ? "Unlock" : "Lock"}</button><button onClick={() => void moderate(selected, selected.status === "resolved" ? "reopen" : "resolve")}><ShieldCheck />{selected.status === "resolved" ? "Reopen" : "Resolve"}</button>{selected.status === "hidden" ? <button onClick={() => void moderate(selected, "restore")}><RotateCcw />Restore</button> : <button className="danger" onClick={() => void moderate(selected, "hide")}><EyeOff />Hide post</button>}</footer>
    </section></div>}
  </div>;
}
