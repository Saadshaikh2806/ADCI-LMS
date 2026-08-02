"use client";

import {
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  ExternalLink,
  LoaderCircle,
  Radio,
  RefreshCw,
  Users,
  Video,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getMyLiveClassWorkspace, type LearnerLiveClass } from "../lib/supabase/learning";
import { getSupabaseBrowserClient } from "../lib/supabase/client";

type ScheduleFilter = "upcoming" | "live" | "past" | "attended" | "all";

const providerNames = {
  zoom: "Zoom",
  google_meet: "Google Meet",
  youtube_live: "YouTube Live"
};

function localDateKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function classState(item: LearnerLiveClass, now: number) {
  const starts = new Date(item.starts_at).getTime();
  const ends = new Date(item.ends_at).getTime();
  if (now >= starts - 15 * 60 * 1000 && now <= ends) return "live";
  if (starts > now) return "upcoming";
  return item.has_attended ? "attended" : "missed";
}

export default function StudentLiveClasses({
  close,
  notify,
  openLesson
}: {
  close: () => void;
  notify: (message: string) => void;
  openLesson: (courseId: string, lessonId: string) => void;
}) {
  const [classes, setClasses] = useState<LearnerLiveClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<ScheduleFilter>("upcoming");
  const [courseId, setCourseId] = useState("all");
  const [date, setDate] = useState("");
  const [now, setNow] = useState(Date.now());

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setClasses(await getMyLiveClassWorkspace());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load live classes");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const courses = useMemo(() => Array.from(new Map(classes.map((item) => [item.course_id, item.course_title])).entries()), [classes]);
  const pastClasses = classes.filter((item) => new Date(item.ends_at).getTime() < now);
  const attendedCount = pastClasses.filter((item) => item.has_attended).length;
  const upcomingCount = classes.filter((item) => new Date(item.ends_at).getTime() >= now).length;
  const liveCount = classes.filter((item) => classState(item, now) === "live").length;
  const nextClass = classes.find((item) => new Date(item.ends_at).getTime() >= now) ?? null;
  const attendanceRate = pastClasses.length ? Math.round(attendedCount / pastClasses.length * 100) : 0;

  const visible = useMemo(() => classes.filter((item) => {
    const state = classState(item, now);
    if (courseId !== "all" && item.course_id !== courseId) return false;
    if (date && localDateKey(item.starts_at) !== date) return false;
    if (filter === "upcoming" && !["upcoming", "live"].includes(state)) return false;
    if (filter === "live" && state !== "live") return false;
    if (filter === "past" && !["attended", "missed"].includes(state)) return false;
    if (filter === "attended" && !item.has_attended) return false;
    return true;
  }), [classes, courseId, date, filter, now]);

  const grouped = useMemo(() => visible.reduce<Record<string, LearnerLiveClass[]>>((groups, item) => {
    const key = localDateKey(item.starts_at);
    groups[key] = [...(groups[key] ?? []), item];
    return groups;
  }, {}), [visible]);

  async function join(item: LearnerLiveClass) {
    const popup = window.open("", "_blank", "noopener,noreferrer");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { popup?.close(); return; }
    setJoining(item.lesson_id);
    setError("");
    const { data, error: joinError } = await supabase.rpc("adci_join_live_class", {
      target_lesson_id: item.lesson_id
    });
    if (joinError) {
      popup?.close();
      setError(joinError.message);
    } else {
      if (popup) popup.location.href = data as string;
      else window.location.href = data as string;
      notify("Attendance recorded. Opening live class.");
      await refresh();
    }
    setJoining("");
  }

  return <div className="live-learning-page">
    <header className="live-learning-header">
      <div><p className="eyebrow">LEARNER SCHEDULE</p><h1>Live classes</h1><span>Join securely, review attendance, and open the connected course lesson.</span></div>
      <button className="live-refresh" disabled={loading} onClick={() => void refresh()}><RefreshCw className={loading ? "spin" : ""} /> Refresh schedule</button>
    </header>

    <div className="live-learning-content">
      <section className="live-learning-metrics">
        <article className={liveCount ? "is-live" : ""}><div><Radio /></div><span>Live now</span><strong>{liveCount}</strong><p>{liveCount ? "Ready to join" : "No class currently live"}</p></article>
        <article><div><CalendarDays /></div><span>Upcoming</span><strong>{upcomingCount}</strong><p>Within your enrolled courses</p></article>
        <article><div><Check /></div><span>Attended</span><strong>{attendedCount}</strong><p>{pastClasses.length} completed sessions</p></article>
        <article><div><Users /></div><span>Attendance rate</span><strong>{attendanceRate}%</strong><p>Based on recorded joins</p></article>
      </section>

      {nextClass && <section className={`next-live-class ${classState(nextClass, now) === "live" ? "is-live" : ""}`}>
        <div className="next-live-date"><span>{new Date(nextClass.starts_at).toLocaleDateString("en-IN", { month: "short" }).toUpperCase()}</span><strong>{new Date(nextClass.starts_at).getDate()}</strong></div>
        <div><p className="eyebrow">{classState(nextClass, now) === "live" ? "LIVE NOW" : "NEXT CLASS"}</p><h2>{nextClass.lesson_title}</h2><span>{nextClass.course_title} - {nextClass.module_title}</span><small><Clock3 /> {new Date(nextClass.starts_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} · {providerNames[nextClass.provider]} · {nextClass.instructor_name}</small></div>
        <button disabled={classState(nextClass, now) !== "live" || joining === nextClass.lesson_id} onClick={() => classState(nextClass, now) === "live" && void join(nextClass)}>{joining === nextClass.lesson_id ? <LoaderCircle className="spin" /> : classState(nextClass, now) === "live" ? <ExternalLink /> : <Clock3 />} {joining === nextClass.lesson_id ? "Opening…" : classState(nextClass, now) === "live" ? "Join class" : "Opens 15 minutes before"}</button>
      </section>}

      <section className="live-learning-schedule">
        <div className="live-learning-toolbar">
          <div>{(["upcoming", "live", "past", "attended", "all"] as ScheduleFilter[]).map((item) => <button className={filter === item ? "active" : ""} key={item} onClick={() => setFilter(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</div>
          <label><BookOpen /><select value={courseId} onChange={(event) => setCourseId(event.target.value)}><option value="all">All courses</option>{courses.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
          <label><CalendarDays /><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          {(date || courseId !== "all") && <button className="clear-live-filters" onClick={() => { setDate(""); setCourseId("all"); }}><X /> Clear</button>}
        </div>

        {error && <div className="live-learning-error">{error}<button onClick={() => void refresh()}><RefreshCw /> Retry</button></div>}
        {loading ? <div className="live-learning-empty"><LoaderCircle className="spin" /><strong>Loading your live schedule…</strong></div>
        : visible.length === 0 ? <div className="live-learning-empty"><Video /><strong>No classes match these filters</strong><p>Try another date, course, or schedule status.</p></div>
        : <div className="live-learning-groups">{Object.entries(grouped).map(([day, dayClasses]) => <section key={day}>
          <header><strong>{new Date(`${day}T12:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</strong><span>{dayClasses.length} class{dayClasses.length === 1 ? "" : "es"}</span></header>
          {dayClasses.map((item) => {
            const state = classState(item, now);
            return <article key={item.lesson_id} className={`state-${state}`}>
              <div className="live-class-time"><strong>{new Date(item.starts_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}</strong><span>{Math.max(1, Math.round((new Date(item.ends_at).getTime() - new Date(item.starts_at).getTime()) / 60000))} minutes</span></div>
              <span className="live-class-provider"><Video />{providerNames[item.provider]}</span>
              <div className="live-class-copy"><div><em>{state === "live" ? "LIVE" : state.toUpperCase()}</em><span>{item.module_title}</span></div><h3>{item.lesson_title}</h3><p>{item.course_title} · {item.instructor_name}</p></div>
              <div className="live-class-attendance">{item.has_attended ? <><Check /><span><strong>Attendance recorded</strong><small>Joined {item.join_count} time{item.join_count === 1 ? "" : "s"}</small></span></> : <><Clock3 /><span><strong>{state === "missed" ? "Not attended" : "Not started"}</strong><small>{state === "missed" ? "No join recorded" : "Attendance records on join"}</small></span></>}</div>
              <div className="live-class-actions"><button onClick={() => openLesson(item.course_id, item.lesson_id)}>Open lesson <ChevronRight /></button><button className="primary" disabled={state !== "live" || joining === item.lesson_id} onClick={() => state === "live" && void join(item)}>{joining === item.lesson_id ? <LoaderCircle className="spin" /> : <ExternalLink />} {joining === item.lesson_id ? "Opening" : "Join"}</button></div>
            </article>;
          })}
        </section>)}</div>}
      </section>
    </div>
  </div>;
}
