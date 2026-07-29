"use client";

import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Download,
  LoaderCircle,
  RefreshCw,
  Search,
  Target,
  UsersRound
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getAdciLearningReport, type AdciLearningReport } from "../lib/supabase/admin";

const statusNames = {
  active: "Active",
  at_risk: "At risk",
  not_started: "Not started",
  nearly_complete: "Nearly complete"
};

function formatLearningTime(seconds: number) {
  const hours = seconds / 3600;
  return hours < 1 ? `${Math.round(seconds / 60)}m` : `${hours.toFixed(1)}h`;
}

function csvCell(value: string | number | null) {
  const text = value === null ? "" : String(value);
  return `"${text.replace(/"/g, "\"\"")}"`;
}

export default function AdminReports({ notify }: { notify: (message: string) => void }) {
  const [report, setReport] = useState<AdciLearningReport | null>(null);
  const [days, setDays] = useState(30);
  const [search, setSearch] = useState("");
  const [riskOnly, setRiskOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setReport(await getAdciLearningReport(days));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load learning report");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [days]);

  const filteredLearners = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (report?.learners ?? []).filter((learner) => {
      const matchesSearch = !query
        || learner.full_name.toLowerCase().includes(query)
        || learner.email.toLowerCase().includes(query);
      const matchesRisk = !riskOnly || learner.engagement_status === "at_risk" || learner.engagement_status === "not_started";
      return matchesSearch && matchesRisk;
    });
  }, [report, search, riskOnly]);

  function exportLearners() {
    if (!report) return;
    const rows = [
      ["Learner", "Email", "Status", "Courses", "Lessons completed", "Total lessons", "Progress", "Accuracy", "Tests", "Learning time", "Last activity"],
      ...filteredLearners.map((learner) => [
        learner.full_name,
        learner.email,
        statusNames[learner.engagement_status],
        learner.courses_enrolled,
        learner.lessons_completed,
        learner.total_lessons,
        `${learner.progress_percent}%`,
        `${learner.accuracy_percent}%`,
        learner.tests_completed,
        formatLearningTime(learner.learning_seconds),
        learner.last_activity ? new Date(learner.last_activity).toLocaleString("en-IN") : "Never"
      ])
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `adci-learner-report-${days}-days.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    notify("Learner performance report exported");
  }

  if (loading && !report) return <div className="admin-report-state"><LoaderCircle className="spin" /><span>Calculating learner performance…</span></div>;
  if (error && !report) return <div className="admin-report-state error"><AlertTriangle /><h2>Report unavailable</h2><p>{error}</p><button onClick={() => void refresh()}><RefreshCw /> Retry</button></div>;

  const summary = report?.summary;
  return <div className="admin-content reports-workspace">
    <div className="admin-welcome reports-heading">
      <div><h2>Learning performance</h2><p>Live engagement, completion and assessment outcomes across ADCI.</p></div>
      <div><select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 12 months</option></select><button onClick={exportLearners}><Download /> Export CSV</button><button className="primary" onClick={() => void refresh()}><RefreshCw className={loading ? "spin" : ""} /> Refresh</button></div>
    </div>
    {error && <div className="course-error">{error}</div>}

    <section className="report-metrics">
      <article><div className="report-metric-icon learners"><UsersRound /></div><span>ACTIVE LEARNERS</span><strong>{summary?.active_learners ?? 0}</strong><p>With current course access</p></article>
      <article><div className="report-metric-icon risk"><AlertTriangle /></div><span>NEEDS ATTENTION</span><strong>{summary?.at_risk_learners ?? 0}</strong><p>Inactive or not started</p></article>
      <article><div className="report-metric-icon completion"><Target /></div><span>AVG. COMPLETION</span><strong>{summary?.average_completion ?? 0}%</strong><p>Across enrolled lessons</p></article>
      <article><div className="report-metric-icon accuracy"><CheckCircle2 /></div><span>QUIZ ACCURACY</span><strong>{summary?.average_accuracy ?? 0}%</strong><p>{summary?.tests_completed ?? 0} scored attempts</p></article>
      <article><div className="report-metric-icon time"><Clock3 /></div><span>LEARNING TIME</span><strong>{summary?.learning_hours ?? 0}h</strong><p>Within selected period</p></article>
      <article><div className="report-metric-icon courses"><BookOpen /></div><span>LIVE COURSES</span><strong>{summary?.published_courses ?? 0}</strong><p>Published programmes</p></article>
    </section>

    <section className="course-performance-card">
      <div className="section-title"><div><h3>Course performance</h3><p>Engagement and outcomes by programme.</p></div><span>{report?.courses.length ?? 0} courses</span></div>
      <div className="course-report-table">
        <div className="course-report-head"><span>COURSE</span><span>LEARNERS</span><span>ENGAGED</span><span>COMPLETION</span><span>ACCURACY</span><span>ATTEMPTS</span></div>
        {(report?.courses ?? []).map((course) => <article key={course.course_id}>
          <div><BookOpen /><span><strong>{course.title}</strong><small>{course.lesson_count} lessons · {course.status}</small></span></div>
          <strong>{course.enrolled_learners}</strong>
          <strong>{course.engaged_learners}</strong>
          <div className="report-progress"><span><i style={{ width: `${course.average_progress}%` }} /></span><strong>{course.average_progress}%</strong></div>
          <strong>{course.accuracy_percent}%</strong>
          <strong>{course.attempts_completed}</strong>
        </article>)}
        {(report?.courses.length ?? 0) === 0 && <div className="report-empty"><BookOpen /> No courses are available for reporting.</div>}
      </div>
    </section>

    <section className="learner-performance-card">
      <div className="section-title learner-report-title"><div><h3>Learner performance</h3><p>Identify disengagement and review individual progress.</p></div><div className="learner-report-tools"><label><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search learner or email" /></label><button className={riskOnly ? "active" : ""} onClick={() => setRiskOnly(!riskOnly)}><AlertTriangle /> At risk only</button></div></div>
      <div className="learner-report-table">
        <div className="learner-report-head"><span>LEARNER</span><span>STATUS</span><span>PROGRESS</span><span>ACCURACY</span><span>TESTS</span><span>STUDY TIME</span><span>LAST ACTIVE</span></div>
        {filteredLearners.map((learner) => <article key={learner.learner_id}>
          <div className="report-person"><span>{learner.full_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span><div><strong>{learner.full_name}</strong><small>{learner.email} · {learner.courses_enrolled} course{learner.courses_enrolled === 1 ? "" : "s"}</small></div></div>
          <em className={`engagement-${learner.engagement_status}`}>{statusNames[learner.engagement_status]}</em>
          <div className="report-progress"><span><i style={{ width: `${learner.progress_percent}%` }} /></span><strong>{learner.progress_percent}%</strong></div>
          <strong>{learner.accuracy_percent}%</strong>
          <strong>{learner.tests_completed}</strong>
          <strong>{formatLearningTime(learner.learning_seconds)}</strong>
          <span className="last-active">{learner.last_activity ? new Date(learner.last_activity).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "Never"} <ArrowRight /></span>
        </article>)}
        {filteredLearners.length === 0 && <div className="report-empty"><BarChart3 /> No learners match this report filter.</div>}
      </div>
    </section>
  </div>;
}
