"use client";

import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CirclePlay,
  ClipboardCheck,
  Clock3,
  LoaderCircle,
  Plus,
  Radio,
  RefreshCw,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "../lib/supabase/client";

type StudyEvent = {
  id: string;
  event_type: "personal" | "live" | "assessment";
  title: string;
  subtitle: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  status: string;
  lesson_id: string | null;
  course_id: string | null;
  provider?: string;
};

type StudyPlanPayload = {
  events: StudyEvent[];
  pending_tasks: number;
  completed_tasks: number;
};

const weekdays = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfCalendar(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  return new Date(first.getFullYear(), first.getMonth(), 1 - mondayOffset);
}

export default function StudyPlan({
  close,
  notify,
  openAssessments
}: {
  close: () => void;
  notify: (message: string) => void;
  openAssessments: (assessmentId: string) => void;
}) {
  const today = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(() => dateKey(today));
  const [plan, setPlan] = useState<StudyPlanPayload>({ events: [], pending_tasks: 0, completed_tasks: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [time, setTime] = useState("18:00");
  const [duration, setDuration] = useState("45");

  const calendarStart = useMemo(() => startOfCalendar(month), [month]);
  const calendarDays = useMemo(
    () => Array.from({ length: 42 }, (_, index) => {
      const day = new Date(calendarStart);
      day.setDate(calendarStart.getDate() + index);
      return day;
    }),
    [calendarStart]
  );
  const calendarEnd = calendarDays[calendarDays.length - 1];

  async function refresh() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    setError("");
    const { data, error: loadError } = await supabase.rpc("adci_get_my_study_plan", {
      target_start: dateKey(calendarStart),
      target_end: dateKey(calendarEnd)
    });
    if (loadError) setError(loadError.message);
    else setPlan(data as StudyPlanPayload);
    setLoading(false);
  }

  useEffect(() => { void refresh(); }, [month]);

  const selectedEvents = plan.events.filter((event) => dateKey(new Date(event.starts_at)) === selectedDate);

  async function createTask(event: React.FormEvent) {
    event.preventDefault();
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    setSaving(true);
    setError("");
    const scheduledFor = new Date(`${selectedDate}T${time}:00`).toISOString();
    const { error: createError } = await supabase.rpc("adci_create_study_task", {
      task_title: title,
      task_notes: notes,
      task_scheduled_for: scheduledFor,
      task_duration_minutes: Number(duration)
    });
    if (createError) setError(createError.message);
    else {
      setTitle("");
      setNotes("");
      setFormOpen(false);
      notify("Study task added to your plan");
      await refresh();
    }
    setSaving(false);
  }

  async function toggleTask(studyEvent: StudyEvent) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    const { error: updateError } = await supabase.rpc("adci_set_study_task_completed", {
      target_task_id: studyEvent.id,
      target_completed: studyEvent.status !== "completed"
    });
    if (updateError) setError(updateError.message);
    else {
      notify(studyEvent.status === "completed" ? "Task returned to your plan" : "Study task completed");
      await refresh();
    }
  }

  async function deleteTask(studyEvent: StudyEvent) {
    if (!window.confirm(`Delete “${studyEvent.title}”?`)) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    const { error: deleteError } = await supabase.rpc("adci_delete_study_task", {
      target_task_id: studyEvent.id
    });
    if (deleteError) setError(deleteError.message);
    else {
      notify("Study task deleted");
      await refresh();
    }
  }

  async function joinLiveClass(studyEvent: StudyEvent) {
    if (!studyEvent.lesson_id) return;
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      setError("Your browser blocked the meeting tab. Allow pop-ups for this LMS and try again.");
      return;
    }
    popup.opener = null;
    popup.document.title = "Opening live class";
    popup.document.body.textContent = "Opening your live class…";
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { popup.close(); return; }
    const { data, error: joinError } = await supabase.rpc("adci_join_live_class", {
      target_lesson_id: studyEvent.lesson_id
    });
    if (joinError) {
      popup.close();
      setError(joinError.message);
    } else {
      popup.location.replace(data as string);
      notify("Attendance recorded. Opening live class.");
    }
  }

  function moveMonth(offset: number) {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }

  return <div className="study-plan-room">
    <header className="study-plan-header">
      <div><p className="eyebrow">MY LEARNING</p><h1>Study plan</h1><span>Build a consistent routine around classes, assessments and revision.</span></div>
      <div className="study-plan-summary"><div><strong>{plan.pending_tasks}</strong><span>Open tasks</span></div><div><strong>{plan.completed_tasks}</strong><span>Completed</span></div></div>
    </header>

    <div className="study-plan-layout">
      <section className="study-calendar">
        <div className="calendar-toolbar">
          <div><h2>{month.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</h2><button onClick={() => { const current = new Date(); setMonth(new Date(current.getFullYear(), current.getMonth(), 1)); setSelectedDate(dateKey(current)); }}>Today</button></div>
          <div><button onClick={() => moveMonth(-1)} aria-label="Previous month"><ChevronLeft /></button><button onClick={() => moveMonth(1)} aria-label="Next month"><ChevronRight /></button></div>
        </div>

        {error && <div className="course-error study-plan-error"><span>{error}</span><button onClick={() => void refresh()}><RefreshCw /> Retry</button></div>}
        <div className="calendar-weekdays">{weekdays.map((day) => <span key={day}>{day}</span>)}</div>
        <div className="calendar-grid">
          {calendarDays.map((day) => {
            const key = dateKey(day);
            const dayEvents = plan.events.filter((event) => dateKey(new Date(event.starts_at)) === key);
            const outside = day.getMonth() !== month.getMonth();
            return <button key={key} className={`${outside ? "outside" : ""} ${key === selectedDate ? "selected" : ""} ${key === dateKey(today) ? "today" : ""}`} onClick={() => setSelectedDate(key)}>
              <span>{day.getDate()}</span>
              <div>{dayEvents.slice(0, 3).map((studyEvent) => <i key={`${studyEvent.event_type}-${studyEvent.id}`} className={studyEvent.event_type} />)}</div>
              {dayEvents.length > 3 && <small>+{dayEvents.length - 3}</small>}
            </button>;
          })}
        </div>
        {loading && <div className="calendar-loading"><LoaderCircle className="spin" /> Updating calendar…</div>}
        <div className="calendar-legend"><span><i className="personal" />Personal task</span><span><i className="live" />Live class</span><span><i className="assessment" />Assessment</span></div>
      </section>

      <aside className="day-agenda">
        <div className="agenda-heading"><div><span>{new Date(`${selectedDate}T12:00:00`).toLocaleDateString("en-IN", { weekday: "long" })}</span><h2>{new Date(`${selectedDate}T12:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "long" })}</h2></div><button onClick={() => setFormOpen(!formOpen)}><Plus /> Add task</button></div>

        {formOpen && <form className="study-task-form" onSubmit={createTask}>
          <label><span>Study task</span><input required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Revise current affairs" /></label>
          <label><span>Notes</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional focus or resource" /></label>
          <div><label><span>Time</span><input required type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label><label><span>Minutes</span><input required type="number" min="5" max="720" value={duration} onChange={(event) => setDuration(event.target.value)} /></label></div>
          <div className="study-task-actions"><button type="button" onClick={() => setFormOpen(false)}>Cancel</button><button className="primary" disabled={saving}>{saving ? <LoaderCircle className="spin" /> : <Plus />} Add to plan</button></div>
        </form>}

        <div className="agenda-events">
          {!loading && selectedEvents.length === 0 ? <div className="agenda-empty"><CalendarDays /><h3>No events planned</h3><p>Add a personal task or choose another date.</p></div>
          : selectedEvents.map((studyEvent) => <article key={`${studyEvent.event_type}-${studyEvent.id}`} className={`${studyEvent.event_type} ${studyEvent.status === "completed" ? "completed" : ""}`}>
            <div className="agenda-time"><strong>{new Date(studyEvent.starts_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</strong><span>{studyEvent.duration_minutes} min</span></div>
            <div className="agenda-event-icon">{studyEvent.event_type === "live" ? <Radio /> : studyEvent.event_type === "assessment" ? <ClipboardCheck /> : studyEvent.status === "completed" ? <Check /> : <Clock3 />}</div>
            <div className="agenda-copy"><span>{studyEvent.event_type === "personal" ? "PERSONAL STUDY" : studyEvent.event_type === "live" ? "LIVE CLASS" : "ASSESSMENT"}</span><h3>{studyEvent.title}</h3><p>{studyEvent.subtitle || (studyEvent.event_type === "personal" ? "Your study task" : "")}</p></div>
            <div className="agenda-actions">
              {studyEvent.event_type === "personal" ? <><button onClick={() => void toggleTask(studyEvent)} title={studyEvent.status === "completed" ? "Mark pending" : "Mark complete"}><Check /></button><button className="delete" onClick={() => void deleteTask(studyEvent)} title="Delete task"><Trash2 /></button></>
              : studyEvent.event_type === "live" ? <button className="event-action" disabled={studyEvent.status !== "live"} onClick={() => void joinLiveClass(studyEvent)}><CirclePlay /> {studyEvent.status === "live" ? "Join" : studyEvent.status === "ended" ? "Ended" : "Scheduled"}</button>
              : <button className="event-action" onClick={() => openAssessments(studyEvent.id)}><ClipboardCheck /> Open</button>}
            </div>
          </article>)}
        </div>
      </aside>
    </div>
  </div>;
}
