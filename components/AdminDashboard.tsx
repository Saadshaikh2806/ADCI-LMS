"use client";

import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  LoaderCircle,
  Plus,
  Radio,
  RefreshCw,
  Target,
  UsersRound,
  Video
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getAdciAdminDashboard, type AdciAdminDashboard } from "../lib/supabase/admin";

const providerNames: Record<string, string> = {
  agora: "ADCI Live Classroom",
  zoom: "Zoom Live",
  youtube_live: "YouTube Live"
};

function readable(value: string) {
  return value.split(/[._]/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

export default function AdminDashboard({
  accountName,
  navigate
}: {
  accountName: string;
  navigate: (section: string) => void;
}) {
  const [dashboard, setDashboard] = useState<AdciAdminDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setDashboard(await getAdciAdminDashboard());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load operations dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const chartMax = useMemo(
    () => Math.max(1, ...(dashboard?.engagement ?? []).flatMap((day) => [day.activity, day.enrolments])),
    [dashboard]
  );

  if (loading && !dashboard) return <div className="admin-report-state"><LoaderCircle className="spin" /><span>Loading institution operations…</span></div>;
  if (error && !dashboard) return <div className="admin-report-state error"><BarChart3 /><h2>Dashboard unavailable</h2><p>{error}</p><button onClick={() => void refresh()}><RefreshCw /> Retry</button></div>;

  const summary = dashboard?.summary;
  const attentionItems = [
    {
      count: dashboard?.attention.at_risk_learners ?? 0,
      title: "At-risk learners",
      detail: "No learning activity for 7+ days",
      color: "red",
      target: "Reports"
    },
    {
      count: dashboard?.attention.courses_in_review ?? 0,
      title: "Courses awaiting review",
      detail: "Academic publishing queue",
      color: "amber",
      target: "Academics"
    },
    {
      count: dashboard?.attention.unscheduled_live_lessons ?? 0,
      title: "Unscheduled live lessons",
      detail: "Lessons need dates and meeting links",
      color: "blue",
      target: "Live schedule"
    },
    {
      count: dashboard?.attention.empty_quizzes ?? 0,
      title: "Quizzes without questions",
      detail: "Assessment content is incomplete",
      color: "purple",
      target: "Question bank"
    }
  ];

  return <div className="admin-content real-admin-dashboard">
    <div className="admin-welcome">
      <div><h2>Good morning, {accountName.split(" ")[0]}.</h2><p>Live operations and learning health across ADCI.</p></div>
      <div className="real-dashboard-actions"><button onClick={() => void refresh()}><RefreshCw className={loading ? "spin" : ""} /> Refresh</button><button className="primary" onClick={() => navigate("Academics")}><Plus /> Create content</button></div>
    </div>
    {error && <div className="course-error">{error}</div>}

    <section className="admin-metrics live-admin-dashboard-metrics">
      <article><span>ACTIVE LEARNERS</span><strong>{summary?.active_learners ?? 0}</strong><p><em>{summary?.published_courses ?? 0} published courses</em></p></article>
      <article><span>LIVE ATTENDANCE</span><strong>{summary?.live_attendance_today ?? 0}</strong><p><em>Learners joined today</em></p></article>
      <article><span>COURSE COMPLETION</span><strong>{summary?.course_completion ?? 0}%</strong><p>Average across active learners</p></article>
      <article><span>AT-RISK LEARNERS</span><strong>{summary?.at_risk_learners ?? 0}</strong><p><b>Requires engagement review</b></p></article>
    </section>

    <div className="admin-grid real-dashboard-grid">
      <section className="operations-card real-engagement-card">
        <div className="section-title"><div><h3>Enrolment and engagement</h3><p>Last 7 days · all programmes</p></div><button onClick={() => navigate("Reports")}>View report <ArrowRight /></button></div>
        <div className="real-chart-legend"><span><i />Learning activity</span><span><i />New enrolments</span></div>
        <div className="real-chart-bars">{dashboard?.engagement.map((day) => <div key={day.date}><span><i style={{ height: `${Math.max(3, day.activity / chartMax * 100)}%` }} title={`${day.activity} activities`} /><b style={{ height: `${Math.max(day.enrolments ? 3 : 0, day.enrolments / chartMax * 100)}%` }} title={`${day.enrolments} enrolments`} /></span><small>{day.label}</small></div>)}</div>
        <div className="chart-summary"><div><span>New enrolments</span><strong>{dashboard?.engagement_summary.new_enrolments ?? 0}</strong></div><div><span>Learning sessions</span><strong>{dashboard?.engagement_summary.learning_sessions ?? 0}</strong></div><div><span>Avg. study time</span><strong>{dashboard?.engagement_summary.average_study_minutes ?? 0} min</strong></div></div>
      </section>

      <section className="attention-card real-attention-card">
        <div className="section-title"><div><h3>Needs attention</h3><p>Prioritised operational queues</p></div><AlertTriangle /></div>
        {attentionItems.map((item) => <button key={item.title} onClick={() => navigate(item.target)}><span className={item.color}>{item.count}</span><div><strong>{item.title}</strong><small>{item.detail}</small></div><ArrowRight /></button>)}
      </section>
    </div>

    <div className="real-dashboard-secondary">
      <section className="course-health-card">
        <div className="section-title"><div><h3>Course health</h3><p>Current completion and learner engagement</p></div><button onClick={() => navigate("Academics")}>Manage courses <ArrowRight /></button></div>
        <div className="course-health-list">
          {(dashboard?.course_health ?? []).slice(0, 6).map((course) => <article key={course.course_id}><div className="course-health-icon"><BookOpen /></div><div><strong>{course.title}</strong><small>{course.lesson_count} lessons · {course.enrolled_learners} learners · {course.engaged_learners} active this week</small></div><em>{course.status.replace("_", " ")}</em><div className="course-health-progress"><span><i style={{ width: `${course.completion_percent}%` }} /></span><strong>{course.completion_percent}%</strong></div></article>)}
          {(dashboard?.course_health.length ?? 0) === 0 && <div className="report-empty"><BookOpen /> No courses have been created yet.</div>}
        </div>
      </section>

      <section className="upcoming-admin-live">
        <div className="section-title"><div><h3>Upcoming live classes</h3><p>Next 14 days</p></div><button onClick={() => navigate("Live schedule")}><CalendarDays /></button></div>
        <div>
          {(dashboard?.upcoming_classes ?? []).slice(0, 5).map((liveClass) => <article key={liveClass.lesson_id}><div className="upcoming-live-time"><strong>{new Date(liveClass.starts_at).toLocaleDateString("en-IN", { day: "2-digit" })}</strong><span>{new Date(liveClass.starts_at).toLocaleDateString("en-IN", { month: "short" })}</span></div><div className="upcoming-live-copy"><span><Radio /> {providerNames[liveClass.provider] ?? liveClass.provider}</span><strong>{liveClass.title}</strong><small>{liveClass.course_title} · {liveClass.instructor_name}</small></div><div><Video /><strong>{new Date(liveClass.starts_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</strong><small>{liveClass.attendance_count} attended</small></div></article>)}
          {(dashboard?.upcoming_classes.length ?? 0) === 0 && <div className="report-empty"><CalendarDays /> No upcoming live classes.</div>}
        </div>
      </section>
    </div>

    <section className="recent-table real-recent-activity">
      <div className="section-title"><div><h3>Recent activity</h3><p>Latest recorded administrative changes</p></div><button onClick={() => navigate("Audit log")}>Full audit log <ArrowRight /></button></div>
      <div className="table-head"><span>ACTIVITY</span><span>ACTOR</span><span>TIME</span><span>ENTITY</span></div>
      {(dashboard?.recent_activity ?? []).map((activity) => <div className="table-row" key={activity.id}><strong>{readable(activity.action)}</strong><span>{activity.actor_name}</span><span>{new Date(activity.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span><em>{readable(activity.entity_type)}</em></div>)}
      {(dashboard?.recent_activity.length ?? 0) === 0 && <div className="report-empty"><CheckCircle2 /> No administrative changes have been recorded yet.</div>}
    </section>
  </div>;
}
