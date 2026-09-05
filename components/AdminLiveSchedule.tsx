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
  Trash2,
  UsersRound,
  Video,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  createAdciBookableLiveSeries,
  deleteAdciLiveSchedule,
  getAdciLiveDeleteDetails,
  getAdciAdminLiveSchedule,
  getAdciLiveAttendance,
  type AdciLiveAttendee,
  type AdciLiveSchedule,
  type AdciScheduledLiveClass
} from "../lib/supabase/admin";
import { openAgoraClassroom } from "./AgoraClassroom";
import { openZoomLive } from "./ZoomLive";

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
  const [filter, setFilter] = useState<"upcoming" | "all" | "scheduled" | "live" | "ended">("upcoming");
  const [now, setNow] = useState(Date.now());
  const [deleteClass, setDeleteClass] = useState<AdciScheduledLiveClass | null>(null);
  const [deleteDetails, setDeleteDetails] = useState<{ purchased_learners: number } | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [attendanceClass, setAttendanceClass] = useState<AdciScheduledLiveClass | null>(null);
  const [attendees, setAttendees] = useState<AdciLiveAttendee[]>([]);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [bookableOpen, setBookableOpen] = useState(false);
  const [bookableProvider, setBookableProvider] = useState<"agora" | "zoom">("agora");
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
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    let cancelled = false;
    setDeleteDetails(null);
    setDeleteError("");
    setDeleteAcknowledged(false);
    if (deleteClass) void getAdciLiveDeleteDetails(deleteClass.lesson_id)
      .then((details) => { if (!cancelled) setDeleteDetails(details); })
      .catch((failure) => { if (!cancelled) setDeleteError(failure instanceof Error ? failure.message : "Unable to verify purchases. Close and try again."); });
    return () => { cancelled = true; };
  }, [deleteClass]);

  const allClasses = useMemo(() => (schedule?.classes ?? []).map((item) => ({
    ...item,
    status: (now > new Date(item.ends_at).getTime() ? "ended" :
      now >= new Date(item.starts_at).getTime() - 15 * 60000 ? "live" : "scheduled") as AdciScheduledLiveClass["status"]
  })), [schedule, now]);
  const visibleClasses = useMemo(
    () => allClasses.filter((liveClass) => filter === "all" ||
      (filter === "upcoming" ? liveClass.status !== "ended" : filter === liveClass.status)),
    [allClasses, filter]
  );
  const liveSummary = useMemo(
    () => ({
      scheduled: allClasses.filter((liveClass) => liveClass.status === "scheduled").length,
      liveNow: allClasses.filter((liveClass) => liveClass.status === "live").length,
      attendance: allClasses.reduce((total, liveClass) => total + liveClass.attendance_count, 0)
    }),
    [allClasses]
  );

  function openBookableSeries(provider: "agora" | "zoom") {
    const start = new Date();
    start.setDate(start.getDate() + 1);
    start.setHours(10, 0, 0, 0);
    const finalDate = new Date(start);
    finalDate.setDate(finalDate.getDate() + 49);
    setBookable((current) => ({
      ...current,
      duration: provider === "zoom" ? "60" : "55",
      startsAt: localDateTime(start.toISOString()),
      repeatUntil: localDateTime(finalDate.toISOString()).slice(0, 10)
    }));
    setBookableProvider(provider);
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
        provider: bookableProvider,
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
      notify(`${result.classes_created} private ${bookableProvider === "zoom" ? "Zoom Live" : "Agora Live"} session${result.classes_created === 1 ? "" : "s"} published`);
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

  function openScheduledClass(liveClass: AdciScheduledLiveClass) {
    if (liveClass.provider === "agora") openAgoraClassroom(liveClass.lesson_id);
    else if (liveClass.provider === "zoom") openZoomLive(liveClass.lesson_id);
    else window.open(liveClass.meeting_url, "_blank", "noopener,noreferrer");
  }

  async function confirmDelete() {
    if (!deleteClass || !deleteDetails || deleting || !deleteAcknowledged) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await deleteAdciLiveSchedule(deleteClass.lesson_id, deleteDetails.purchased_learners);
      setSchedule((current) => current ? { ...current, classes: current.classes.filter((item) => item.lesson_id !== deleteClass.lesson_id) } : current);
      setDeleteClass(null);
      notify("Live class deleted from the LMS. Payment and attendance records retained.");
      await refresh();
    } catch (failure) {
      setDeleteError(failure instanceof Error ? failure.message : "Deletion failed. Close and reopen to check purchases again.");
      setDeleteDetails(null);
    } finally {
      setDeleting(false);
    }
  }

  if (loading && !schedule) return <div className="admin-report-state"><LoaderCircle className="spin" /><span>Loading live timetable…</span></div>;
  if (error && !schedule) return <div className="admin-report-state error"><Radio /><h2>Schedule unavailable</h2><p>{error}</p><button onClick={() => void refresh()}><RefreshCw /> Retry</button></div>;

  return <div className="admin-content admin-live-workspace">
    <div className="admin-welcome admin-live-heading">
      <div><h2>Live schedule</h2><p>Create private LMS classrooms and monitor learner attendance.</p></div>
      <div><select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value="7">Next 7 days</option><option value="30">Next 30 days</option><option value="90">Next 90 days</option><option value="180">Next 6 months</option></select><button onClick={() => void refresh()}><RefreshCw className={loading ? "spin" : ""} /> Refresh</button><button onClick={() => openBookableSeries("agora")}><Plus /> Agora Live</button><button className="primary" onClick={() => openBookableSeries("zoom")}><Video /> Zoom Live</button></div>
    </div>
    {error && <div className="course-error">{error}</div>}

    <section className="live-admin-metrics">
      <article><div><CalendarDays /></div><span>SCHEDULED</span><strong>{liveSummary.scheduled}</strong><p>Agora and Zoom Live sessions</p></article>
      <article><div className="is-live"><Radio /></div><span>LIVE NOW</span><strong>{liveSummary.liveNow}</strong><p>Join window is open</p></article>
      <article><div className="attendance"><UsersRound /></div><span>ATTENDANCE</span><strong>{liveSummary.attendance}</strong><p>Unique session records</p></article>
    </section>

    <section className="live-schedule-card">
      <div className="live-admin-toolbar">
        <div>{(["upcoming", "scheduled", "live", "ended", "all"] as const).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item === "all" ? "All classes" : item[0].toUpperCase() + item.slice(1)}</button>)}</div>
        <span>{visibleClasses.length} result{visibleClasses.length === 1 ? "" : "s"}</span>
      </div>

      <div className="admin-live-list">
        {visibleClasses.map((liveClass) => {
          const start = new Date(liveClass.starts_at);
          return <article key={liveClass.lesson_id} className={liveClass.status}>
            <div className="live-date"><strong>{start.toLocaleDateString("en-IN", { day: "2-digit" })}</strong><span>{start.toLocaleDateString("en-IN", { month: "short" }).toUpperCase()}</span></div>
            <div className="live-provider"><Video /><span>{liveClass.provider === "zoom" ? "Zoom Live" : liveClass.provider === "agora" ? "Agora Live" : "Live stream"}</span></div>
            <div className="live-admin-copy"><div><em>{liveClass.status}</em><span>{start.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}–{new Date(liveClass.ends_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span></div><h3>{liveClass.lesson_title}</h3><p>{liveClass.course_title} · {liveClass.module_title} · {liveClass.instructor_name}</p></div>
            <button className="attendance-button" title="Open authorised buyer list" onClick={() => void openAttendance(liveClass)}><UsersRound /><span><strong>{liveClass.attendance_count}</strong><small>{liveClass.total_joins} joins</small></span></button>
            <div className="live-admin-actions">
              {liveClass.offer_id && <button title="Copy purchase link" onClick={() => void copyPurchaseLink(liveClass.offer_id as string)}><Copy /></button>}
              <button title={liveClass.status !== "live" ? "Classroom opens 15 minutes before the session" : "Open classroom"} disabled={liveClass.status !== "live"} onClick={() => openScheduledClass(liveClass)}><Video /></button>
              <button className="delete" title="Delete class" aria-label={`Delete ${liveClass.lesson_title}`} onClick={() => setDeleteClass(liveClass)}><Trash2 /></button>
            </div>
          </article>;
        })}
        {visibleClasses.length === 0 && <div className="report-empty"><CalendarDays /> No classes match this schedule filter.</div>}
      </div>
    </section>

    {deleteClass && <div className="course-dialog-backdrop"><section className="lesson-content-editor live-admin-editor" role="dialog" aria-modal="true" aria-labelledby="delete-live-title">
      <div className="course-dialog-head"><div><p className="eyebrow">DELETE LIVE CLASS</p><h2 id="delete-live-title">{deleteClass.lesson_title}</h2><span>{new Date(deleteClass.starts_at).toLocaleString("en-IN")} – {new Date(deleteClass.ends_at).toLocaleTimeString("en-IN")}</span></div><button disabled={deleting} aria-label="Close delete confirmation" onClick={() => setDeleteClass(null)}><X /></button></div>
      {!deleteDetails && !deleteError && <p><LoaderCircle className="spin" /> Checking purchases…</p>}
      {deleteDetails && <>
        <p><strong>{deleteDetails.purchased_learners} learner{deleteDetails.purchased_learners === 1 ? " has" : "s have"} purchased access to this class or its course (including refunded purchases).</strong></p>
        <p>This removes this session from the LMS and prevents new LMS joins. Other dates in the series are kept. Payment, invoice and attendance records are preserved.</p>
        {deleteDetails.purchased_learners > 0 && <div className="course-error">These learners will lose access to this class. Deleting it will not issue refunds. Arrange refunds or a replacement separately.</div>}
        {deleteClass.provider === "zoom" && <p>The meeting in Zoom itself must be cancelled separately if you also want to invalidate previously issued Zoom links.</p>}
        <label><input type="checkbox" checked={deleteAcknowledged} disabled={deleting} onChange={(event) => setDeleteAcknowledged(event.target.checked)} /> I understand and want to delete this class.</label>
      </>}
      {deleteError && <div className="course-error" role="alert">{deleteError}</div>}
      <div className="course-dialog-actions"><button disabled={deleting} onClick={() => setDeleteClass(null)}>Cancel</button><button className="primary" disabled={deleting || !deleteDetails || !deleteAcknowledged} onClick={() => void confirmDelete()}>{deleting ? <LoaderCircle className="spin" /> : <Trash2 />} {deleting ? "Deleting…" : "Delete class"}</button></div>
    </section></div>}

    {bookableOpen && <div className="course-dialog-backdrop"><form className="lesson-content-editor live-admin-editor" onSubmit={createBookableSeries}>
      <div className="course-dialog-head"><div><p className="eyebrow">{bookableProvider === "zoom" ? "ZOOM LIVE" : "AGORA LIVE"}</p><h2>Create {bookableProvider === "zoom" ? "Zoom Live" : "Agora Live"}</h2><span>Each date is sold separately and can use any day or time.</span></div><button type="button" onClick={() => setBookableOpen(false)}><X /></button></div>
      <div className="content-editor-note"><ShieldCheck /><span><strong>Automatic LMS access</strong><small>{bookableProvider === "zoom" ? "The LMS creates the Zoom meeting and gives every paid learner a different account-bound code. Meeting links stay hidden." : "The system creates a private Agora classroom for each date. Paid learners are verified and admitted automatically."}</small></span></div>
      <div className="live-class-grid">
        <label className="wide"><span>Session title</span><input required minLength={3} value={bookable.title} onChange={(event) => setBookable({ ...bookable, title: event.target.value })} /></label>
        <label className="wide"><span>Description</span><textarea rows={3} value={bookable.description} onChange={(event) => setBookable({ ...bookable, description: event.target.value })} /></label>
        <label><span>Instructor</span><input required value={bookable.instructor} onChange={(event) => setBookable({ ...bookable, instructor: event.target.value })} /></label>
        <label><span>First session</span><input required type="datetime-local" value={bookable.startsAt} onChange={(event) => setBookable({ ...bookable, startsAt: event.target.value })} /></label>
        <label><span>Duration (minutes)</span><input required min="15" max={bookableProvider === "zoom" ? "480" : "60"} type="number" value={bookable.duration} onChange={(event) => setBookable({ ...bookable, duration: event.target.value })} /></label>
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
