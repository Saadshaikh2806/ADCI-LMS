"use client";

import {
  AlarmClock,
  ArrowLeft,
  ArrowRight,
  Award,
  Check,
  ClipboardCheck,
  Clock3,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Target
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getMyAssessmentCentre, type LearnerAssessment } from "../lib/supabase/learning";

type AssessmentFilter = "all" | "available" | "in_progress" | "completed" | "passed";

function durationLabel(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function deadlineLabel(value: string | null) {
  if (!value) return "No closing date";
  return `Available until ${new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`;
}

function remainingLabel(deadline: string | null, now: number) {
  if (!deadline) return "";
  const remaining = Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 1000));
  return `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
}

export default function StudentAssessmentCentre({
  close,
  openAssessment
}: {
  close: () => void;
  openAssessment: (assessmentId: string) => void;
}) {
  const [assessments, setAssessments] = useState<LearnerAssessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<AssessmentFilter>("all");
  const [courseId, setCourseId] = useState("all");
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(Date.now());

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setAssessments(await getMyAssessmentCentre());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load assessments");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const courses = useMemo(() => Array.from(new Map(assessments.map((item) => [item.course_id, item.course_title])).entries()), [assessments]);
  const inProgressCount = assessments.filter((item) => item.state === "in_progress").length;
  const completed = assessments.filter((item) => item.state === "completed");
  const passedCount = completed.filter((item) => item.passed).length;
  const availableCount = assessments.filter((item) => item.state === "available" || (item.state === "completed" && item.can_start)).length;
  const passRate = completed.length ? Math.round(passedCount / completed.length * 100) : 0;

  const visible = useMemo(() => assessments.filter((item) => {
    if (courseId !== "all" && item.course_id !== courseId) return false;
    const normalized = query.trim().toLowerCase();
    if (normalized && !`${item.title} ${item.course_title} ${item.module_title ?? ""}`.toLowerCase().includes(normalized)) return false;
    if (filter === "available" && !(item.state === "available" || (item.state === "completed" && item.can_start))) return false;
    if (filter === "in_progress" && item.state !== "in_progress") return false;
    if (filter === "completed" && item.state !== "completed") return false;
    if (filter === "passed" && !item.passed) return false;
    return true;
  }), [assessments, courseId, filter, query]);

  return <div className="assessment-centre-page">
    <header className="assessment-centre-header">
      <div><button onClick={close}><ArrowLeft /> Dashboard</button><p className="eyebrow">EXAM WORKSPACE</p><h1>Assessments</h1><span>Start tests, resume active attempts, and review your latest scores.</span></div>
      <button disabled={loading} onClick={() => void refresh()}><RefreshCw className={loading ? "spin" : ""} /> Refresh</button>
    </header>

    <div className="assessment-centre-content">
      <section className="assessment-centre-metrics">
        <article><div><ClipboardCheck /></div><span>Available</span><strong>{availableCount}</strong><p>Ready to attempt</p></article>
        <article className={inProgressCount ? "active" : ""}><div><AlarmClock /></div><span>In progress</span><strong>{inProgressCount}</strong><p>{inProgressCount ? "Timer is running" : "No active attempt"}</p></article>
        <article><div><Check /></div><span>Completed</span><strong>{completed.length}</strong><p>{passedCount} passed</p></article>
        <article><div><Target /></div><span>Pass rate</span><strong>{passRate}%</strong><p>Latest scored attempts</p></article>
      </section>

      <section className="assessment-centre-list">
        <div className="assessment-centre-toolbar">
          <div>{(["all", "available", "in_progress", "completed", "passed"] as AssessmentFilter[]).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item === "in_progress" ? "In progress" : item[0].toUpperCase() + item.slice(1)}</button>)}</div>
          <label><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search assessments" /></label>
          <select value={courseId} onChange={(event) => setCourseId(event.target.value)}><option value="all">All courses</option>{courses.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select>
        </div>

        {error && <div className="assessment-centre-error"><ShieldCheck /><span>{error}</span><button onClick={() => void refresh()}><RefreshCw /> Retry</button></div>}
        {loading ? <div className="assessment-centre-empty"><LoaderCircle className="spin" /><strong>Loading your assessments…</strong></div>
        : visible.length === 0 ? <div className="assessment-centre-empty"><ClipboardCheck /><strong>No assessments match this view</strong><p>Published quizzes will appear here when they are available to your courses.</p></div>
        : <div className="assessment-cards">{visible.map((item) => {
          const scorePercent = item.latest_score !== null && item.max_score > 0 ? Math.round(item.latest_score / item.max_score * 100) : null;
          return <article key={item.id} className={`state-${item.state} ${item.passed ? "passed" : ""}`}>
            <div className="assessment-card-top">
              <span className="assessment-card-icon"><ClipboardCheck /></span>
              <div><p>{item.course_title}{item.module_title ? ` - ${item.module_title}` : ""}</p><h2>{item.title}</h2><span>{deadlineLabel(item.available_until)}</span></div>
              <em>{item.state === "in_progress" ? "IN PROGRESS" : item.state === "completed" ? item.passed ? "PASSED" : item.can_start ? "RETRY AVAILABLE" : "COMPLETED" : "AVAILABLE"}</em>
            </div>

            <div className="assessment-card-details">
              <span><ClipboardCheck /><strong>{item.question_count}</strong><small>Questions</small></span>
              <span><Clock3 /><strong>{durationLabel(item.duration_seconds)}</strong><small>Time limit</small></span>
              <span><Award /><strong>+{item.positive_marks} / -{item.negative_marks}</strong><small>Marking</small></span>
              <span><Target /><strong>{item.pass_percent}%</strong><small>Pass mark</small></span>
            </div>

            {item.state === "in_progress" ? <div className="assessment-active-attempt"><AlarmClock /><span><strong>{remainingLabel(item.server_deadline_at, now)}</strong><small>Server time remaining · your saved attempt will resume</small></span></div>
            : item.latest_score !== null ? <div className={`assessment-latest-result ${item.passed ? "passed" : ""}`}><span><strong>{item.latest_score} / {item.max_score}</strong><small>Latest score{item.latest_timed_out ? " · timed out" : ""}</small></span><div><i style={{ width: `${Math.max(0, Math.min(100, scorePercent ?? 0))}%` }} /></div><em>{scorePercent}%</em></div>
            : <div className="assessment-first-attempt"><ShieldCheck /> The timer starts only after you confirm inside the secure exam room.</div>}

            <footer>
              <span>{item.attempts_used} of {item.max_attempts} attempts used</span>
              <button disabled={!item.can_start && item.state !== "in_progress" && item.latest_attempt_id === null} onClick={() => openAssessment(item.id)}>
                {item.state === "in_progress" ? <><AlarmClock /> Resume attempt</> : item.can_start ? item.attempts_used > 0 ? <><RotateCcw /> Attempt again</> : <><ClipboardCheck /> Start assessment</> : <><Award /> View result</>} <ArrowRight />
              </button>
            </footer>
          </article>;
        })}</div>}
      </section>
    </div>
  </div>;
}
