"use client";

import {
  ArrowRight,
  AlarmClock,
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  CirclePlay,
  FileText,
  Flag,
  Flame,
  GraduationCap,
  History,
  LayoutDashboard,
  LoaderCircle,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  Play,
  Search,
  ShieldCheck,
  Settings,
  Sparkles,
  Target,
  Trophy,
  UserCog,
  UsersRound,
  Users,
  Video,
  X
} from "lucide-react";
import { useEffect, useState } from "react";
import { isSupabaseConfigured } from "../lib/supabase/client";
import AuthGate, { useAuthSession } from "../components/AuthGate";
import AdminCourseManager from "../components/AdminCourseManager";
import AdminPeopleManager from "../components/AdminPeopleManager";
import AdminReports from "../components/AdminReports";
import AdminLiveSchedule from "../components/AdminLiveSchedule";
import AdminQuestionBank from "../components/AdminQuestionBank";
import AdminAuditLog from "../components/AdminAuditLog";
import AdminDashboard from "../components/AdminDashboard";
import StudentQuizRunner from "../components/StudentQuizRunner";
import LiveClassSchedule from "../components/LiveClassSchedule";
import StudentCourses from "../components/StudentCourses";
import StudentCoursePlayer from "../components/StudentCoursePlayer";
import StudyPlan from "../components/StudyPlan";
import { hasAcademicAdminRole, loadMyAdciMemberships } from "../lib/supabase/admin";
import { getLearnerDashboard, type LearnerDashboard } from "../lib/supabase/learning";

const navItems = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "My courses", icon: BookOpen },
  { label: "Live classes", icon: Video },
  { label: "Assessments", icon: ClipboardCheck },
  { label: "Study plan", icon: CalendarDays },
  { label: "Community", icon: Users }
];

const courses = [
  { title: "Indian Polity & Governance", meta: "18 of 24 lessons", progress: 72, accent: "saffron", code: "POLITY" },
  { title: "Modern Indian History", meta: "11 of 20 lessons", progress: 54, accent: "blue", code: "HISTORY" },
  { title: "Economy & Development", meta: "7 of 18 lessons", progress: 38, accent: "green", code: "ECONOMY" }
];

const schedule = [
  { time: "10:30", suffix: "AM", title: "Fundamental Rights", teacher: "Dr. Meera Iyer", type: "Live class", icon: Video, live: true },
  { time: "02:00", suffix: "PM", title: "Weekly mentor check-in", teacher: "Arjun Rao", type: "Mentoring", icon: MessageSquareText },
  { time: "06:00", suffix: "PM", title: "Polity sectional test", teacher: "30 questions · 40 min", type: "Assessment", icon: ClipboardCheck }
];

const polityLessons = [
  { title: "Constitutional foundations", detail: "Video · 18 min", done: true },
  { title: "Parliament and amendment powers", detail: "Lesson · 24 min", done: true },
  { title: "The Basic Structure Doctrine", detail: "Video · 31 min", current: true },
  { title: "Landmark judgements", detail: "Reading · 16 min" },
  { title: "Practice: constitutional limits", detail: "Quiz · 20 questions" }
];

const examQuestions = [
  {
    question: "Which case established that Parliament cannot alter the basic structure of the Constitution?",
    options: ["Golaknath v. State of Punjab", "Kesavananda Bharati v. State of Kerala", "Minerva Mills v. Union of India", "S.R. Bommai v. Union of India"],
    answer: 1,
    topic: "Constitutional amendments"
  },
  {
    question: "Which of the following is generally recognised as part of the basic structure?",
    options: ["Unlimited parliamentary sovereignty", "Judicial review", "Suspension of all fundamental rights", "A unitary form of government"],
    answer: 1,
    topic: "Core constitutional principles"
  },
  {
    question: "Article 368 of the Constitution primarily deals with:",
    options: ["Emergency provisions", "Constitutional amendment procedure", "Inter-state trade", "Election of the President"],
    answer: 1,
    topic: "Article 368"
  },
  {
    question: "In Minerva Mills, the Supreme Court emphasised harmony between:",
    options: ["The Union and the States", "Fundamental Rights and Directive Principles", "Parliament and the Election Commission", "The President and the Prime Minister"],
    answer: 1,
    topic: "Landmark judgements"
  },
  {
    question: "The basic structure doctrine primarily limits the power of:",
    options: ["The Election Commission", "Constitutional amendment by Parliament", "State legislatures to pass money bills", "Courts to issue writs"],
    answer: 1,
    topic: "Doctrine and limits"
  }
];

function LearningHub() {
  const backendConnected = isSupabaseConfigured();
  const authSession = useAuthSession();
  const accountName = authSession?.user.user_metadata?.full_name || authSession?.user.email?.split("@")[0] || "ADCI Learner";
  const accountInitials = accountName.split(/\s+/).slice(0, 2).map((part: string) => part[0]).join("").toUpperCase();
  const [active, setActive] = useState("Overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [completed, setCompleted] = useState(false);
  const [lessonOpen, setLessonOpen] = useState(false);
  const [examOpen, setExamOpen] = useState(false);
  const [activeAssessmentId, setActiveAssessmentId] = useState("");
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminSection, setAdminSection] = useState("Dashboard");
  const [profileOpen, setProfileOpen] = useState(false);
  const [canAdminister, setCanAdminister] = useState(false);
  const [examStarted, setExamStarted] = useState(false);
  const [examSubmitted, setExamSubmitted] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [flagged, setFlagged] = useState<number[]>([]);
  const [secondsLeft, setSecondsLeft] = useState(40 * 60);
  const [hydrated, setHydrated] = useState(false);
  const [dashboard, setDashboard] = useState<LearnerDashboard | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState("");
  const [openLearning, setOpenLearning] = useState<{ courseId: string; lessonId?: string } | null>(null);

  async function refreshLearnerDashboard() {
    setDashboardLoading(true);
    setDashboardError("");
    try {
      setDashboard(await getLearnerDashboard());
    } catch (loadError) {
      setDashboardError(loadError instanceof Error ? loadError.message : "Unable to load learning activity");
    } finally {
      setDashboardLoading(false);
    }
  }

  useEffect(() => {
    if (authSession) void refreshLearnerDashboard();
  }, [authSession]);

  useEffect(() => {
    const saved = window.localStorage.getItem("adci-learning-state");
    if (saved) {
      try {
        const state = JSON.parse(saved);
        setCompleted(Boolean(state.completed));
        setAnswers(state.answers ?? {});
        setFlagged(state.flagged ?? []);
        setSecondsLeft(state.secondsLeft ?? 40 * 60);
      } catch {
        // Ignore damaged browser state and start from the safe default.
      }
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) {
      window.localStorage.setItem("adci-learning-state", JSON.stringify({ completed, answers, flagged, secondsLeft }));
    }
  }, [completed, answers, flagged, secondsLeft, hydrated]);

  useEffect(() => {
    if (!examStarted || examSubmitted || secondsLeft <= 0) return;
    const timer = window.setInterval(() => setSecondsLeft((value) => value - 1), 1000);
    return () => window.clearInterval(timer);
  }, [examStarted, examSubmitted, secondsLeft]);

  useEffect(() => {
    if (examStarted && secondsLeft === 0) setExamSubmitted(true);
  }, [examStarted, secondsLeft]);

  useEffect(() => {
    if (!authSession) return;
    let active = true;
    async function loadRole() {
      try {
        const memberships = await loadMyAdciMemberships();
        if (active) setCanAdminister(hasAcademicAdminRole(memberships));
      } catch {
        if (active) setCanAdminister(false);
      }
    }
    void loadRole();
    const retry = window.setTimeout(loadRole, 1800);
    return () => { active = false; window.clearTimeout(retry); };
  }, [authSession]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  const correctCount = Object.entries(answers).filter(([index, value]) => examQuestions[Number(index)].answer === value).length;
  const incorrectCount = Object.entries(answers).filter(([index, value]) => examQuestions[Number(index)].answer !== value).length;
  const finalScore = Math.max(0, correctCount * 2 - incorrectCount * 0.66);
  const continueLesson = dashboard?.continue_lesson;
  const weeklyGoalPercent = Math.min(100, Math.round((dashboard?.weekly_learning_seconds ?? 0) / (8 * 60 * 60) * 100));
  const weeklyHours = (dashboard?.weekly_learning_seconds ?? 0) / 3600;
  const totalHours = (dashboard?.learning_seconds ?? 0) / 3600;
  const currentDate = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "2-digit",
    month: "long"
  }).toUpperCase();

  return (
    <main className="app-shell">
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><GraduationCap size={22} /></div>
          <div><strong>ADCI</strong><span>Learning Hub</span></div>
        </div>

        <nav aria-label="Main navigation">
          <p className="nav-label">LEARN</p>
          {navItems.map(({ label, icon: Icon }) => {
            const badge = label === "Live classes" && (dashboard?.upcoming_live_count ?? 0) > 0
              ? String(dashboard?.upcoming_live_count)
              : "";
            return <button key={label} className={`nav-item ${active === label ? "active" : ""}`} onClick={() => { if (label === "Assessments") { setActiveAssessmentId(""); setExamOpen(true); } else setActive(label); setMenuOpen(false); }}>
              <Icon size={19} strokeWidth={1.8} /><span>{label}</span>{badge && <em>{badge}</em>}
            </button>;
          })}
        </nav>

        <div className="sidebar-bottom">
          <button className="nav-item"><CircleHelp size={19} /><span>Help centre</span></button>
          <button className="nav-item"><Settings size={19} /><span>Settings</span></button>
          <div className="mentor-card">
            <div className="mentor-icon"><Sparkles size={20} /></div>
            <strong>Need a study nudge?</strong>
            <p>Your mentor is available today.</p>
            <button onClick={() => notify("Mentor chat opened")}>Message mentor <ArrowRight size={14} /></button>
          </div>
        </div>
      </aside>

      {menuOpen && <button className="scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}

      <section className="workspace">
        <header className="topbar">
          <button className="menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Open menu">{menuOpen ? <X /> : <Menu />}</button>
          <div className="search">
            <Search size={19} />
            <input aria-label="Search" placeholder="Search lessons, tests, notes..." onKeyDown={(event) => event.key === "Enter" && notify(`Searching for “${event.currentTarget.value}”`)} />
            <kbd>⌘ K</kbd>
          </div>
          <div className="top-actions">
            <button className="icon-button" aria-label="Notifications" onClick={() => notify("You have 3 new notifications")}><Bell size={20} /><i /></button>
            <button className="profile" onClick={() => setProfileOpen(!profileOpen)}>
              <span>{accountInitials}</span>
              <div><strong>{accountName}</strong><small>UPSC Foundation</small></div>
              <ChevronRight size={16} />
            </button>
            {profileOpen && <div className="profile-menu"><button className="selected"><GraduationCap size={17} /><span><strong>Learner portal</strong><small>Continue studying</small></span><Check size={15} /></button>{canAdminister && <button onClick={() => { setAdminOpen(true); setProfileOpen(false); }}><UserCog size={17} /><span><strong>Admin workspace</strong><small>Manage the institution</small></span><ArrowRight size={15} /></button>}</div>}
          </div>
        </header>

        <div className="content">
          <div className="welcome">
            <div>
              <p className="eyebrow">{currentDate}</p>
              <h1>Good morning, {accountName.split(" ")[0]}.</h1>
              <p>{dashboardError ? "Your dashboard needs the latest Supabase migration." : "Your live learning activity is ready."}</p>
            </div>
            <div className="streak"><Flame size={24} fill="currentColor" /><div><strong>{dashboard?.streak_days ?? 0} day streak</strong><span>Based on completed learning activity</span></div></div>
          </div>

          <section className="hero-card">
            <div className="hero-copy">
              <div className="status-row"><span className="pill"><Play size={12} fill="currentColor" /> {continueLesson ? "CONTINUE LEARNING" : "MY LEARNING"}</span><span>{continueLesson ? `${Math.max(1, Math.ceil((continueLesson.duration_seconds - continueLesson.position_seconds) / 60))} min left` : `${dashboard?.courses.length ?? 0} courses`}</span></div>
              <p className="hero-kicker">{continueLesson ? `${continueLesson.course_title} · ${continueLesson.module_title}` : "ANEES DEFENCE CAREER INSTITUTE"}</p>
              <h2>{continueLesson?.lesson_title ?? (dashboardLoading ? "Loading your next lesson…" : "Your learning journey starts here")}</h2>
              <p>{continueLesson ? `Resume your ${continueLesson.lesson_type} lesson from ${continueLesson.progress_percent}% progress.` : "Open My courses to begin a published course assigned by your administrator."}</p>
              <div className="hero-actions">
                <button className="primary" disabled={!continueLesson} onClick={() => continueLesson && setOpenLearning({ courseId: continueLesson.course_id, lessonId: continueLesson.lesson_id })}>{dashboardLoading ? <LoaderCircle size={16} className="spin" /> : <Play size={16} fill="currentColor" />} {dashboardLoading ? "Loading…" : continueLesson ? "Resume lesson" : "No lesson available"}</button>
                <button className="save" onClick={() => setActive("My courses")}><BookOpen size={17} /> View my courses</button>
              </div>
            </div>
            <div className="lesson-art" aria-hidden="true">
              <div className="art-grid" />
              <div className="monument"><span /><span /><span /><span /><i /></div>
              <div className="topic-tag">CONSTITUTIONAL LAW</div>
            </div>
          </section>

          <section className="metrics" aria-label="Learning progress">
            <article><div className="metric-icon amber"><Target size={20} /></div><div><span>Weekly goal</span><strong>{weeklyHours < 1 ? `${Math.round(weeklyHours * 60)}m` : `${weeklyHours.toFixed(1)}h`} <small>/ 8h</small></strong></div><div className="mini-progress"><i style={{ width: `${weeklyGoalPercent}%` }} /></div><em>{weeklyGoalPercent}%</em></article>
            <article><div className="metric-icon green"><Trophy size={20} /></div><div><span>Practice accuracy</span><strong>{dashboard?.accuracy_percent ?? 0}%</strong></div><div className="trend">{dashboard?.correct_answers ?? 0} of {dashboard?.answered_questions ?? 0} answers correct</div></article>
            <article><div className="metric-icon blue"><ClipboardCheck size={20} /></div><div><span>Tests completed</span><strong>{dashboard?.tests_completed ?? 0}</strong></div><div className="trend">{dashboard?.assessments_due ?? 0} available to attempt</div></article>
            <article><div className="metric-icon purple"><Clock3 size={20} /></div><div><span>Learning time</span><strong>{totalHours < 1 ? `${Math.round(totalHours * 60)}m` : `${totalHours.toFixed(1)}h`}</strong></div><div className="trend">Saved across all lessons</div></article>
          </section>

          <div className="main-grid">
            <section>
              <div className="section-title"><div><h3>Continue your courses</h3><p>Pick up where you left off.</p></div><button onClick={() => setActive("My courses")}>View all <ArrowRight size={15} /></button></div>
              <div className="course-list">
                {dashboardLoading ? <div className="dashboard-data-state"><LoaderCircle className="spin" /> Loading enrolled courses…</div>
                : dashboardError ? <div className="dashboard-data-state error"><ShieldCheck /> <span>{dashboardError}</span><button onClick={() => void refreshLearnerDashboard()}>Retry</button></div>
                : (dashboard?.courses.length ?? 0) === 0 ? <div className="dashboard-data-state"><BookOpen /> No published courses are assigned yet.</div>
                : dashboard?.courses.slice(0, 3).map((course, index) => {
                  const progress = course.lesson_count ? Math.round(course.completed_count / course.lesson_count * 100) : 0;
                  return <article className="course-card" key={course.id}>
                    <div className={`course-cover ${["saffron", "blue", "green"][index % 3]}`}><span>{course.slug.slice(0, 8).toUpperCase()}</span><BookOpen size={25} /></div>
                    <div className="course-info"><h4>{course.title}</h4><p>{course.completed_count} of {course.lesson_count} lessons</p><div className="progress-line"><i style={{ width: `${progress}%` }} /></div></div>
                    <strong className="percent">{progress}%</strong>
                    <button className="circle-button" aria-label={`Open ${course.title}`} onClick={() => setOpenLearning({ courseId: course.id, lessonId: course.next_lesson?.id })}><ChevronRight size={19} /></button>
                  </article>;
                })}
              </div>
            </section>

            <aside className="today-card">
              <div className="section-title"><div><h3>Live classes</h3><p>Your protected course schedule</p></div><button className="more"><MoreHorizontal size={20} /></button></div>
              <LiveClassSchedule notify={notify} />
              <button className="calendar-button" onClick={() => setActive("Study plan")}><CalendarDays size={17} /> Open full calendar</button>
            </aside>
          </div>
        </div>

        <nav className="mobile-nav" aria-label="Mobile navigation">
          {navItems.slice(0, 4).map(({ label, icon: Icon }) => <button key={label} className={active === label ? "active" : ""} onClick={() => label === "Assessments" ? (setActiveAssessmentId(""), setExamOpen(true)) : setActive(label)}><Icon size={20} /><span>{label === "Live classes" ? "Live" : label}</span></button>)}
        </nav>
      </section>

      {active !== "Overview" && active !== "My courses" && active !== "Study plan" && !lessonOpen && (
        <div className="route-overlay">
          <button className="overlay-close" onClick={() => setActive("Overview")}><X /></button>
          <div className="overlay-icon">{(() => { const item = navItems.find((n) => n.label === active); const Icon = item?.icon ?? BookOpen; return <Icon size={30} />; })()}</div>
          <p className="eyebrow">ADCI LEARNING HUB</p>
          <h2>{active}</h2>
          <p>This module is mapped into the product architecture and ready for its data integration sprint.</p>
          <button className="primary" onClick={() => setActive("Overview")}><ArrowRight size={17} /> Back to dashboard</button>
        </div>
      )}
      {active === "My courses" && !lessonOpen && <StudentCourses close={() => { setActive("Overview"); void refreshLearnerDashboard(); }} notify={notify} />}
      {active === "Study plan" && !lessonOpen && <StudyPlan close={() => setActive("Overview")} notify={notify} openAssessments={(assessmentId) => { setActiveAssessmentId(assessmentId); setExamOpen(true); }} />}
      {openLearning && <StudentCoursePlayer
        courseId={openLearning.courseId}
        initialLessonId={openLearning.lessonId}
        notify={notify}
        close={() => {
          setOpenLearning(null);
          void refreshLearnerDashboard();
        }}
      />}

      {lessonOpen && (
        <div className="learning-room">
          <header className="learning-header">
            <button className="back-button" onClick={() => setLessonOpen(false)}><ChevronRight size={18} /> Dashboard</button>
            <div><span>INDIAN POLITY · MODULE 06</span><strong>Basic Structure Doctrine</strong></div>
            <div className="secure-session"><ShieldCheck size={16} /> Progress secured</div>
          </header>
          <div className="learning-layout">
            <section className="lesson-stage">
              <div className="video-stage">
                <div className="video-emblem"><GraduationCap size={44} /></div>
                <p>ADCI MASTERCLASS</p>
                <h2>The Basic Structure Doctrine</h2>
                <button onClick={() => notify("Lesson playback started")} aria-label="Play lesson"><Play size={26} fill="currentColor" /></button>
                <div className="video-controls"><i /><span>18:42 / 31:08</span></div>
              </div>
              <div className="lesson-body">
                <div className="lesson-heading">
                  <div><p className="eyebrow">LESSON 3 OF 5</p><h1>Understanding the Basic Structure Doctrine</h1></div>
                  <button className={`complete-large ${completed ? "done" : ""}`} onClick={() => setCompleted(!completed)}><Check size={18} /> {completed ? "Completed" : "Mark complete"}</button>
                </div>
                <p className="lesson-summary">In this lesson, Dr. Meera Iyer traces the doctrine from the Kesavananda Bharati judgement and explains why Parliament’s amending power remains broad—but not unlimited.</p>
                <div className="resource-row">
                  <button onClick={() => notify("Lesson notes opened")}><FileText size={19} /><span><strong>Lesson notes</strong><small>PDF · 8 pages</small></span><ChevronRight size={17} /></button>
                  <button onClick={() => notify("Practice set opened")}><ClipboardCheck size={19} /><span><strong>Quick practice</strong><small>8 questions · 10 min</small></span><ChevronRight size={17} /></button>
                </div>
              </div>
            </section>
            <aside className="lesson-outline">
              <div className="outline-title"><div><span>COURSE CONTENT</span><h3>Module 06</h3></div><strong>72%</strong></div>
              <div className="outline-progress"><i style={{ width: completed ? "82%" : "72%" }} /></div>
              <div className="lesson-items">
                {polityLessons.map((lesson, index) => (
                  <button key={lesson.title} className={lesson.current ? "current" : ""} onClick={() => lesson.current ? notify("You’re already here") : notify(lesson.done ? `${lesson.title} opened` : "Complete the current lesson to continue")}>
                    <span className={`lesson-state ${lesson.done || (lesson.current && completed) ? "done" : ""}`}>{lesson.done || (lesson.current && completed) ? <Check size={14} /> : lesson.current ? <CirclePlay size={15} /> : index + 1}</span>
                    <span><strong>{lesson.title}</strong><small>{lesson.detail}</small></span>
                  </button>
                ))}
              </div>
              <div className="mentor-note"><MessageSquareText size={19} /><div><strong>Ask your mentor</strong><p>Questions about this topic? Arjun usually replies within 2 hours.</p></div></div>
            </aside>
          </div>
        </div>
      )}

      {examOpen && <StudentQuizRunner assessmentId={activeAssessmentId || undefined} close={() => { setExamOpen(false); setActiveAssessmentId(""); void refreshLearnerDashboard(); }} />}
      {false && examOpen && (
        <div className="exam-room">
          {!examStarted ? (
            <section className="exam-intro">
              <button className="overlay-close" onClick={() => setExamOpen(false)}><X /></button>
              <div className="exam-badge"><ClipboardCheck size={29} /></div>
              <p className="eyebrow">SECTIONAL ASSESSMENT</p>
              <h1>Indian Polity: Basic Structure</h1>
              <p>Test your understanding of constitutional amendments, judicial review and landmark judgements.</p>
              <div className="exam-rules">
                <div><AlarmClock size={20} /><span><strong>40 minutes</strong><small>Server-style countdown</small></span></div>
                <div><ClipboardCheck size={20} /><span><strong>5 questions</strong><small>One correct answer each</small></span></div>
                <div><Target size={20} /><span><strong>+2 / -0.66</strong><small>Negative marking applies</small></span></div>
                <div><ShieldCheck size={20} /><span><strong>Autosaved</strong><small>Resume after refresh</small></span></div>
              </div>
              <div className="integrity-note"><ShieldCheck size={19} /><p><strong>Your attempt is protected.</strong> Answers save automatically in this browser. You can flag questions and move freely before submission.</p></div>
              <button className="primary start-exam" onClick={() => setExamStarted(true)}>Start assessment <ArrowRight size={17} /></button>
            </section>
          ) : examSubmitted ? (
            <section className="result-panel">
              <button className="overlay-close" onClick={() => { setExamOpen(false); setExamStarted(false); setExamSubmitted(false); }}><X /></button>
              <div className="result-ring" style={{ "--score": `${finalScore / 10 * 100}%` } as React.CSSProperties}>
                <span><strong>{finalScore.toFixed(2)}</strong>/ 10</span>
              </div>
              <p className="eyebrow">ASSESSMENT COMPLETE</p>
              <h1>Strong work, {accountName.split(" ")[0]}.</h1>
              <p>Your attempt was submitted successfully. Review the topic breakdown before your next revision block.</p>
              <div className="result-stats">
                <div><span>Correct</span><strong>{correctCount}</strong></div>
                <div><span>Incorrect</span><strong>{incorrectCount}</strong></div>
                <div><span>Unanswered</span><strong>{examQuestions.length - Object.keys(answers).length}</strong></div>
                <div><span>Time used</span><strong>{Math.floor((40 * 60 - secondsLeft) / 60)}m</strong></div>
              </div>
              <div className="result-actions">
                <button className="primary" onClick={() => { setExamOpen(false); setExamStarted(false); setExamSubmitted(false); }}>Return to dashboard</button>
                <button className="save" onClick={() => notify("Detailed solutions will unlock after the review window")}><FileText size={17} /> View solutions</button>
              </div>
            </section>
          ) : (
            <>
              <header className="exam-header">
                <div><ClipboardCheck size={20} /><span><strong>Polity sectional test</strong><small>Autosaved just now</small></span></div>
                <div className={`exam-timer ${secondsLeft < 300 ? "warning" : ""}`}><AlarmClock size={18} /><span>{String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:{String(secondsLeft % 60).padStart(2, "0")}</span></div>
                <button onClick={() => setExamSubmitted(true)}>Submit test</button>
              </header>
              <div className="exam-layout">
                <section className="question-panel">
                  <div className="question-meta"><span>QUESTION {currentQuestion + 1} OF {examQuestions.length}</span><em>+2 marks · -0.66 marks</em></div>
                  <h2>{examQuestions[currentQuestion].question}</h2>
                  <div className="options">
                    {examQuestions[currentQuestion].options.map((option, index) => (
                      <button key={option} className={answers[currentQuestion] === index ? "selected" : ""} onClick={() => setAnswers((value) => ({ ...value, [currentQuestion]: index }))}>
                        <span>{String.fromCharCode(65 + index)}</span><strong>{option}</strong>{answers[currentQuestion] === index && <Check size={18} />}
                      </button>
                    ))}
                  </div>
                  <div className="question-actions">
                    <button className={flagged.includes(currentQuestion) ? "flagged" : ""} onClick={() => setFlagged((items) => items.includes(currentQuestion) ? items.filter((item) => item !== currentQuestion) : [...items, currentQuestion])}><Flag size={16} /> {flagged.includes(currentQuestion) ? "Flagged" : "Flag for review"}</button>
                    <div><button disabled={currentQuestion === 0} onClick={() => setCurrentQuestion((value) => value - 1)}>Previous</button><button className="primary" onClick={() => currentQuestion === examQuestions.length - 1 ? setExamSubmitted(true) : setCurrentQuestion((value) => value + 1)}>{currentQuestion === examQuestions.length - 1 ? "Finish" : "Save & next"} <ArrowRight size={15} /></button></div>
                  </div>
                </section>
                <aside className="question-palette">
                  <p className="eyebrow">QUESTION PALETTE</p>
                  <div className="palette-grid">{examQuestions.map((_, index) => <button key={index} className={`${currentQuestion === index ? "current" : ""} ${answers[index] !== undefined ? "answered" : ""} ${flagged.includes(index) ? "flagged" : ""}`} onClick={() => setCurrentQuestion(index)}>{index + 1}</button>)}</div>
                  <div className="palette-legend"><span><i className="answered" />Answered</span><span><i />Not answered</span><span><i className="flagged" />Review</span></div>
                  <div className="save-status"><ShieldCheck size={17} /><span><strong>Attempt autosaved</strong><small>Your latest answer is recoverable.</small></span></div>
                </aside>
              </div>
            </>
          )}
        </div>
      )}

      {adminOpen && (
        <div className="admin-app">
          <aside className="admin-sidebar">
            <div className="brand"><div className="brand-mark"><GraduationCap size={22} /></div><div><strong>ADCI</strong><span>Administration</span></div></div>
            <p className="nav-label">WORKSPACE</p>
            {[
              ["Dashboard", LayoutDashboard],
              ["People", UsersRound],
              ["Academics", BookOpen],
              ["Question bank", ClipboardCheck],
              ["Live schedule", CalendarDays],
              ["Reports", BarChart3],
              ["Audit log", History]
            ].map(([label, Icon]) => <button key={label as string} className={`nav-item ${adminSection === label ? "active" : ""}`} onClick={() => setAdminSection(label as string)}><Icon size={18} /><span>{label as string}</span>{label === "Academics" && <em>3</em>}</button>)}
            <div className="admin-user"><span>{accountInitials}</span><div><strong>{accountName}</strong><small>Super administrator</small></div><button onClick={() => setAdminOpen(false)} aria-label="Return to learner portal"><X size={17} /></button></div>
          </aside>
          <section className="admin-workspace">
            <header className="admin-topbar"><div><p className="eyebrow">ANEES DEFENCE CAREER INSTITUTE</p><h1>{adminSection}</h1></div><div><span className={`data-mode ${backendConnected ? "connected" : ""}`}><i />{backendConnected ? "Supabase connected" : "Demo data"}</span><button className="icon-button"><Bell size={20} /><i /></button><button className="admin-avatar">{accountInitials}</button></div></header>
            {adminSection === "Dashboard" ? (
              <AdminDashboard accountName={accountName} navigate={setAdminSection} />
            ) : adminSection === "Academics" ? (
              <AdminCourseManager notify={notify} />
            ) : adminSection === "People" ? (
              <AdminPeopleManager notify={notify} />
            ) : adminSection === "Reports" ? (
              <AdminReports notify={notify} />
            ) : adminSection === "Live schedule" ? (
              <AdminLiveSchedule notify={notify} />
            ) : adminSection === "Question bank" ? (
              <AdminQuestionBank notify={notify} />
            ) : adminSection === "Audit log" ? (
              <AdminAuditLog notify={notify} />
            ) : (
              <div className="admin-empty"><div className="overlay-icon">{adminSection === "People" ? <UsersRound /> : adminSection === "Reports" ? <BarChart3 /> : <Settings />}</div><p className="eyebrow">ADMIN MODULE</p><h2>{adminSection}</h2><p>This operational module is connected to the shared administration shell and ready for its dedicated workflow.</p><button className="primary" onClick={() => setAdminSection("Dashboard")}>Return to dashboard</button></div>
            )}
          </section>
        </div>
      )}

      {toast && <div className="toast"><Check size={17} />{toast}</div>}
    </main>
  );
}

export default function Home() {
  return <AuthGate><LearningHub /></AuthGate>;
}
