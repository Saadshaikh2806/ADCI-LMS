"use client";

import {
  CalendarDays,
  Check,
  Clock3,
  ExternalLink,
  LoaderCircle,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Trash2,
  UsersRound,
  Video,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  deleteAdciLiveSchedule,
  getAdciAdminLiveSchedule,
  getAdciLiveAttendance,
  saveAdciLiveClass,
  type AdciLiveAttendee,
  type AdciLiveClass,
  type AdciLiveSchedule,
  type AdciScheduledLiveClass,
  type AdciUnscheduledLiveLesson
} from "../lib/supabase/admin";

const providerNames = {
  zoom: "Zoom",
  google_meet: "Google Meet",
  youtube_live: "YouTube Live"
};

function localDateTime(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function AdminLiveSchedule({ notify }: { notify: (message: string) => void }) {
  const [schedule, setSchedule] = useState<AdciLiveSchedule | null>(null);
  const [days, setDays] = useState(30);
  const [filter, setFilter] = useState<"all" | "scheduled" | "live" | "ended" | "unscheduled">("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editorLesson, setEditorLesson] = useState<AdciScheduledLiveClass | AdciUnscheduledLiveLesson | null>(null);
  const [provider, setProvider] = useState<AdciLiveClass["provider"]>("google_meet");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [instructor, setInstructor] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [attendanceClass, setAttendanceClass] = useState<AdciScheduledLiveClass | null>(null);
  const [attendees, setAttendees] = useState<AdciLiveAttendee[]>([]);
  const [attendanceLoading, setAttendanceLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setSchedule(await getAdciAdminLiveSchedule(days));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load live schedule");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [days]);

  const visibleClasses = useMemo(
    () => (schedule?.classes ?? []).filter((liveClass) => filter === "all" || filter === liveClass.status),
    [schedule, filter]
  );

  function openEditor(liveLesson: AdciScheduledLiveClass | AdciUnscheduledLiveLesson) {
    setEditorLesson(liveLesson);
    if ("provider" in liveLesson) {
      setProvider(liveLesson.provider);
      setMeetingUrl(liveLesson.meeting_url);
      setInstructor(liveLesson.instructor_name);
      setStartsAt(localDateTime(liveLesson.starts_at));
      setEndsAt(localDateTime(liveLesson.ends_at));
    } else {
      const start = new Date();
      start.setDate(start.getDate() + 1);
      start.setHours(10, 0, 0, 0);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      setProvider("google_meet");
      setMeetingUrl("");
      setInstructor("");
      setStartsAt(localDateTime(start.toISOString()));
      setEndsAt(localDateTime(end.toISOString()));
    }
    setError("");
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editorLesson) return;
    setError("");
    const startDate = new Date(startsAt);
    const endDate = new Date(endsAt);
    if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) {
      setError("Choose valid start and end times.");
      return;
    }
    if (endDate <= startDate) {
      setError("The live class must end after it starts.");
      return;
    }
    if (!meetingUrl.trim().toLowerCase().startsWith("https://")) {
      setError("Enter a secure HTTPS meeting or stream URL.");
      return;
    }
    if (instructor.trim().length < 2) {
      setError("Enter the instructor name.");
      return;
    }
    setSaving(true);
    try {
      await saveAdciLiveClass(editorLesson.lesson_id, {
        provider,
        meeting_url: meetingUrl.trim(),
        instructor_name: instructor.trim(),
        starts_at: startDate.toISOString(),
        ends_at: endDate.toISOString()
      });
      notify("Live class schedule saved");
      setEditorLesson(null);
      await refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String((saveError as { message?: string })?.message || "Unable to save live class"));
    } finally {
      setSaving(false);
    }
  }

  async function remove(liveClass: AdciScheduledLiveClass) {
    if (!window.confirm(`Remove the schedule for “${liveClass.lesson_title}”? The live lesson remains available to reschedule.`)) return;
    setSaving(true);
    setError("");
    try {
      await deleteAdciLiveSchedule(liveClass.lesson_id);
      notify("Live schedule removed");
      await refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to remove live schedule");
    } finally {
      setSaving(false);
    }
  }

  async function openAttendance(liveClass: AdciScheduledLiveClass) {
    setAttendanceClass(liveClass);
    setAttendanceLoading(true);
    setError("");
    try {
      setAttendees(await getAdciLiveAttendance(liveClass.lesson_id));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load attendance");
    } finally {
      setAttendanceLoading(false);
    }
  }

  if (loading && !schedule) return <div className="admin-report-state"><LoaderCircle className="spin" /><span>Loading live timetable…</span></div>;
  if (error && !schedule) return <div className="admin-report-state error"><Radio /><h2>Schedule unavailable</h2><p>{error}</p><button onClick={() => void refresh()}><RefreshCw /> Retry</button></div>;

  return <div className="admin-content admin-live-workspace">
    <div className="admin-welcome admin-live-heading">
      <div><h2>Live schedule</h2><p>Schedule external classrooms and monitor learner attendance.</p></div>
      <div><select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value="7">Next 7 days</option><option value="30">Next 30 days</option><option value="90">Next 90 days</option><option value="180">Next 6 months</option></select><button onClick={() => void refresh()}><RefreshCw className={loading ? "spin" : ""} /> Refresh</button><button className="primary" disabled={!schedule?.unscheduled_lessons.length} onClick={() => schedule?.unscheduled_lessons[0] && openEditor(schedule.unscheduled_lessons[0])}><Plus /> Schedule class</button></div>
    </div>
    {error && <div className="course-error">{error}</div>}

    <section className="live-admin-metrics">
      <article><div><CalendarDays /></div><span>SCHEDULED</span><strong>{schedule?.summary.scheduled ?? 0}</strong><p>Within selected window</p></article>
      <article><div className="is-live"><Radio /></div><span>LIVE NOW</span><strong>{schedule?.summary.live_now ?? 0}</strong><p>Join window is open</p></article>
      <article><div className="attendance"><UsersRound /></div><span>ATTENDANCE</span><strong>{schedule?.summary.attendance ?? 0}</strong><p>Unique session records</p></article>
      <article><div className="unscheduled"><Clock3 /></div><span>UNSCHEDULED</span><strong>{schedule?.summary.unscheduled ?? 0}</strong><p>Live lessons awaiting dates</p></article>
    </section>

    <section className="live-schedule-card">
      <div className="live-admin-toolbar">
        <div>{(["all", "scheduled", "live", "ended", "unscheduled"] as const).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item === "all" ? "All classes" : item[0].toUpperCase() + item.slice(1)}</button>)}</div>
        <span>{filter === "unscheduled" ? schedule?.unscheduled_lessons.length ?? 0 : visibleClasses.length} result{(filter === "unscheduled" ? schedule?.unscheduled_lessons.length : visibleClasses.length) === 1 ? "" : "s"}</span>
      </div>

      {filter === "unscheduled" ? <div className="unscheduled-live-list">
        {(schedule?.unscheduled_lessons ?? []).map((lesson) => <article key={lesson.lesson_id}><div><Clock3 /><span><strong>{lesson.lesson_title}</strong><small>{lesson.course_title} · {lesson.module_title}</small></span></div><em>{lesson.course_status}</em><button onClick={() => openEditor(lesson)}><Plus /> Schedule</button></article>)}
        {(schedule?.unscheduled_lessons.length ?? 0) === 0 && <div className="report-empty"><Check /> Every live lesson has a schedule.</div>}
      </div> : <div className="admin-live-list">
        {visibleClasses.map((liveClass) => {
          const start = new Date(liveClass.starts_at);
          return <article key={liveClass.lesson_id} className={liveClass.status}>
            <div className="live-date"><strong>{start.toLocaleDateString("en-IN", { day: "2-digit" })}</strong><span>{start.toLocaleDateString("en-IN", { month: "short" }).toUpperCase()}</span></div>
            <div className="live-provider"><Video /><span>{providerNames[liveClass.provider]}</span></div>
            <div className="live-admin-copy"><div><em>{liveClass.status}</em><span>{start.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}–{new Date(liveClass.ends_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span></div><h3>{liveClass.lesson_title}</h3><p>{liveClass.course_title} · {liveClass.module_title} · {liveClass.instructor_name}</p></div>
            <button className="attendance-button" onClick={() => void openAttendance(liveClass)}><UsersRound /><span><strong>{liveClass.attendance_count}</strong><small>{liveClass.total_joins} joins</small></span></button>
            <div className="live-admin-actions"><button title="Open meeting link" onClick={() => window.open(liveClass.meeting_url, "_blank", "noopener,noreferrer")}><ExternalLink /></button><button title="Edit schedule" onClick={() => openEditor(liveClass)}><Pencil /></button><button className="delete" title="Remove schedule" disabled={saving} onClick={() => void remove(liveClass)}><Trash2 /></button></div>
          </article>;
        })}
        {visibleClasses.length === 0 && <div className="report-empty"><CalendarDays /> No classes match this schedule filter.</div>}
      </div>}
    </section>

    {editorLesson && <div className="course-dialog-backdrop"><form className="lesson-content-editor live-admin-editor" onSubmit={save}>
      <div className="course-dialog-head"><div><p className="eyebrow">LIVE CLASS SCHEDULER</p><h2>{editorLesson.lesson_title}</h2><span>{editorLesson.course_title} · {editorLesson.module_title}</span></div><button type="button" onClick={() => setEditorLesson(null)}><X /></button></div>
      <div className="content-editor-note"><Radio /><span><strong>Protected external classroom</strong><small>The meeting URL is returned only when an enrolled learner joins during the allowed window.</small></span></div>
      <div className="live-class-grid"><label><span>Provider</span><select value={provider} onChange={(event) => setProvider(event.target.value as AdciLiveClass["provider"])}><option value="google_meet">Google Meet</option><option value="zoom">Zoom</option><option value="youtube_live">YouTube Live</option></select></label><label><span>Instructor</span><input required value={instructor} onChange={(event) => setInstructor(event.target.value)} placeholder="Instructor name" /></label><label className="wide"><span>HTTPS meeting or stream URL</span><input required type="url" value={meetingUrl} onChange={(event) => setMeetingUrl(event.target.value)} placeholder="https://…" /></label><label><span>Starts</span><input required type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label><label><span>Ends</span><input required type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label></div>
      {error && <div className="course-error">{error}</div>}
      <div className="course-dialog-actions"><button type="button" onClick={() => setEditorLesson(null)}>Cancel</button><button className="primary" disabled={saving}>{saving ? <LoaderCircle className="spin" /> : <Check />} Save schedule</button></div>
    </form></div>}

    {attendanceClass && <div className="course-dialog-backdrop"><section className="attendance-dialog">
      <div className="course-dialog-head"><div><p className="eyebrow">LIVE ATTENDANCE</p><h2>{attendanceClass.lesson_title}</h2><span>{attendanceClass.attendance_count} learner{attendanceClass.attendance_count === 1 ? "" : "s"} attended</span></div><button onClick={() => setAttendanceClass(null)}><X /></button></div>
      {attendanceLoading ? <div className="cms-loading"><LoaderCircle className="spin" /> Loading attendance…</div> : <div className="attendance-list"><div className="attendance-head"><span>LEARNER</span><span>FIRST JOINED</span><span>LAST JOINED</span><span>JOINS</span></div>{attendees.map((attendee) => <article key={attendee.learner_id}><div><span>{attendee.full_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span><div><strong>{attendee.full_name}</strong><small>{attendee.email}</small></div></div><span>{new Date(attendee.joined_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span><span>{new Date(attendee.last_joined_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span><strong>{attendee.join_count}</strong></article>)}{attendees.length === 0 && <div className="report-empty"><UsersRound /> No learner has joined this class yet.</div>}</div>}
    </section></div>}
  </div>;
}
