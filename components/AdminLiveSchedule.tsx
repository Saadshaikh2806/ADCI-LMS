"use client";

import {
  CalendarDays,
  Check,
  Copy,
  LoaderCircle,
  Plus,
  Radio,
  RefreshCw,
  ShieldCheck,
  UsersRound,
  Video,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  createAdciBookableLiveSeries,
  getAdciAdminLiveSchedule,
  getAdciLiveAttendance,
  type AdciLiveAttendee,
  type AdciLiveSchedule,
  type AdciScheduledLiveClass
} from "../lib/supabase/admin";
import { openAgoraClassroom } from "./AgoraClassroom";

function localDateTime(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function AdminLiveSchedule({ notify }: {
  notify: (message: string) => void;
}) {
  const [schedule, setSchedule] = useState<AdciLiveSchedule | null>(null);
  const [days, setDays] = useState(30);
  const [filter, setFilter] = useState<"all" | "scheduled" | "live" | "ended">("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [attendanceClass, setAttendanceClass] = useState<AdciScheduledLiveClass | null>(null);
  const [attendees, setAttendees] = useState<AdciLiveAttendee[]>([]);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [bookableOpen, setBookableOpen] = useState(false);
  const [bookable, setBookable] = useState({
    title: "Online Career Counselling",
    description: "Live online career counselling with an ADCI expert.",
    instructor: "",
    startsAt: "",
    duration: "55",
    recurrence: "weekly" as "once" | "weekly",
    repeatUntil: "",
    price: "",
    gstRate: "18"
  });

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

  const agoraClasses = useMemo(
    () => (schedule?.classes ?? []).filter((liveClass) => liveClass.provider === "agora"),
    [schedule]
  );
  const visibleClasses = useMemo(
    () => agoraClasses.filter((liveClass) => filter === "all" || filter === liveClass.status),
    [agoraClasses, filter]
  );
  const agoraSummary = useMemo(
    () => ({
      scheduled: agoraClasses.filter((liveClass) => liveClass.status === "scheduled").length,
      liveNow: agoraClasses.filter((liveClass) => liveClass.status === "live").length,
      attendance: agoraClasses.reduce((total, liveClass) => total + liveClass.attendance_count, 0)
    }),
    [agoraClasses]
  );

  function openBookableSeries() {
    const start = new Date();
    start.setDate(start.getDate() + 1);
    start.setHours(10, 0, 0, 0);
    const finalDate = new Date(start);
    finalDate.setDate(finalDate.getDate() + 49);
    setBookable((current) => ({
      ...current,
      startsAt: localDateTime(start.toISOString()),
      repeatUntil: localDateTime(finalDate.toISOString()).slice(0, 10)
    }));
    setBookableOpen(true);
    setError("");
  }

  async function createBookableSeries(event: React.FormEvent) {
    event.preventDefault();
    const start = new Date(bookable.startsAt);
    if (!Number.isFinite(start.getTime())) return setError("Choose a valid start time.");
    if (bookable.recurrence === "weekly" && !bookable.repeatUntil) return setError("Choose the final recurrence date.");
    setSaving(true);
    setError("");
    try {
      const result = await createAdciBookableLiveSeries({
        title: bookable.title,
        description: bookable.description,
        instructor: bookable.instructor,
        startsAt: start.toISOString(),
        durationMinutes: Number(bookable.duration),
        recurrence: bookable.recurrence,
        repeatUntil: bookable.repeatUntil,
        pricePaise: Math.round(Number(bookable.price) * 100),
        gstRate: Number(bookable.gstRate)
      });
      notify(`${result.classes_created} private Agora session${result.classes_created === 1 ? "" : "s"} published`);
      setBookableOpen(false);
      await refresh();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create live sessions");
    } finally {
      setSaving(false);
    }
  }

  async function copyPurchaseLink(offerId: string) {
    await navigator.clipboard.writeText(`${window.location.origin}/?offer=${offerId}`);
    notify("Purchase link copied");
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
      <div><h2>Live schedule</h2><p>Create private LMS classrooms and monitor learner attendance.</p></div>
      <div><select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value="7">Next 7 days</option><option value="30">Next 30 days</option><option value="90">Next 90 days</option><option value="180">Next 6 months</option></select><button onClick={() => void refresh()}><RefreshCw className={loading ? "spin" : ""} /> Refresh</button><button className="primary" onClick={openBookableSeries}><Plus /> Create live session</button></div>
    </div>
    {error && <div className="course-error">{error}</div>}

    <section className="live-admin-metrics">
      <article><div><CalendarDays /></div><span>SCHEDULED</span><strong>{agoraSummary.scheduled}</strong><p>Agora sessions in this window</p></article>
      <article><div className="is-live"><Radio /></div><span>LIVE NOW</span><strong>{agoraSummary.liveNow}</strong><p>Join window is open</p></article>
      <article><div className="attendance"><UsersRound /></div><span>ATTENDANCE</span><strong>{agoraSummary.attendance}</strong><p>Unique session records</p></article>
    </section>

    <section className="live-schedule-card">
      <div className="live-admin-toolbar">
        <div>{(["all", "scheduled", "live", "ended"] as const).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item === "all" ? "All classes" : item[0].toUpperCase() + item.slice(1)}</button>)}</div>
        <span>{visibleClasses.length} result{visibleClasses.length === 1 ? "" : "s"}</span>
      </div>

      <div className="admin-live-list">
        {visibleClasses.map((liveClass) => {
          const start = new Date(liveClass.starts_at);
          return <article key={liveClass.lesson_id} className={liveClass.status}>
            <div className="live-date"><strong>{start.toLocaleDateString("en-IN", { day: "2-digit" })}</strong><span>{start.toLocaleDateString("en-IN", { month: "short" }).toUpperCase()}</span></div>
            <div className="live-provider"><Video /><span>ADCI Live Classroom</span></div>
            <div className="live-admin-copy"><div><em>{liveClass.status}</em><span>{start.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}–{new Date(liveClass.ends_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span></div><h3>{liveClass.lesson_title}</h3><p>{liveClass.course_title} · {liveClass.module_title} · {liveClass.instructor_name}</p></div>
            <button className="attendance-button" title="Open authorised buyer list" onClick={() => void openAttendance(liveClass)}><UsersRound /><span><strong>{liveClass.attendance_count}</strong><small>{liveClass.total_joins} joins</small></span></button>
            <div className="live-admin-actions">
              {liveClass.offer_id && <button title="Copy purchase link" onClick={() => void copyPurchaseLink(liveClass.offer_id as string)}><Copy /></button>}
              <button title={liveClass.status !== "live" ? "Classroom opens 15 minutes before the session" : "Open classroom"} disabled={liveClass.status !== "live"} onClick={() => openAgoraClassroom(liveClass.lesson_id)}><Video /></button>
            </div>
          </article>;
        })}
        {visibleClasses.length === 0 && <div className="report-empty"><CalendarDays /> No classes match this schedule filter.</div>}
      </div>
    </section>

    {bookableOpen && <div className="course-dialog-backdrop"><form className="lesson-content-editor live-admin-editor" onSubmit={createBookableSeries}>
      <div className="course-dialog-head"><div><p className="eyebrow">AGORA LIVE SESSION</p><h2>Create live session</h2><span>Each date is sold separately and can use any day or time.</span></div><button type="button" onClick={() => setBookableOpen(false)}><X /></button></div>
      <div className="content-editor-note"><ShieldCheck /><span><strong>Automatic LMS access</strong><small>The system creates a private classroom for each date. Paid learners are verified and admitted automatically—there is no public meeting link or lobby.</small></span></div>
      <div className="live-class-grid">
        <label className="wide"><span>Session title</span><input required minLength={3} value={bookable.title} onChange={(event) => setBookable({ ...bookable, title: event.target.value })} /></label>
        <label className="wide"><span>Description</span><textarea rows={3} value={bookable.description} onChange={(event) => setBookable({ ...bookable, description: event.target.value })} /></label>
        <label><span>Instructor</span><input required value={bookable.instructor} onChange={(event) => setBookable({ ...bookable, instructor: event.target.value })} /></label>
        <label><span>First session</span><input required type="datetime-local" value={bookable.startsAt} onChange={(event) => setBookable({ ...bookable, startsAt: event.target.value })} /></label>
        <label><span>Duration (minutes)</span><input required min="15" max="60" type="number" value={bookable.duration} onChange={(event) => setBookable({ ...bookable, duration: event.target.value })} /></label>
        <label><span>Schedule</span><select value={bookable.recurrence} onChange={(event) => setBookable({ ...bookable, recurrence: event.target.value as "once" | "weekly" })}><option value="once">One session</option><option value="weekly">Repeat weekly</option></select></label>
        {bookable.recurrence === "weekly" && <label><span>Repeat until</span><input required type="date" min={bookable.startsAt.slice(0, 10)} value={bookable.repeatUntil} onChange={(event) => setBookable({ ...bookable, repeatUntil: event.target.value })} /></label>}
        <label><span>Price (INR)</span><input required min="1" step=".01" type="number" value={bookable.price} onChange={(event) => setBookable({ ...bookable, price: event.target.value })} /></label>
        <label><span>GST rate (%)</span><input required min="0" max="100" step=".01" type="number" value={bookable.gstRate} onChange={(event) => setBookable({ ...bookable, gstRate: event.target.value })} /></label>
      </div>
      {error && <div className="course-error">{error}</div>}
      <div className="course-dialog-actions"><button type="button" onClick={() => setBookableOpen(false)}>Cancel</button><button className="primary" disabled={saving}>{saving ? <LoaderCircle className="spin" /> : <Check />} Create and publish</button></div>
    </form></div>}

    {attendanceClass && <div className="course-dialog-backdrop"><section className="attendance-dialog">
      <div className="course-dialog-head"><div><p className="eyebrow">ENROLLED LEARNERS</p><h2>{attendanceClass.lesson_title}</h2><span>{attendees.length} learner{attendees.length === 1 ? "" : "s"} currently have access; admission is automatic.</span></div><button onClick={() => setAttendanceClass(null)}><X /></button></div>
      {attendanceLoading ? <div className="cms-loading"><LoaderCircle className="spin" /> Loading access list…</div> : <div className="attendance-list"><div className="attendance-head"><span>LEARNER</span><span>FIRST JOINED</span><span>LAST JOINED</span><span>JOINS</span></div>{attendees.map((attendee) => <article key={attendee.learner_id}><div><span>{attendee.full_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span><div><strong>{attendee.full_name}</strong><small>{attendee.email}</small></div></div><span>{attendee.joined_at ? new Date(attendee.joined_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Not joined"}</span><span>{attendee.last_joined_at ? new Date(attendee.last_joined_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—"}</span><strong>{attendee.join_count}</strong></article>)}{attendees.length === 0 && <div className="report-empty"><UsersRound /> No authorised buyer has access to this session yet.</div>}</div>}
    </section></div>}
  </div>;
}
