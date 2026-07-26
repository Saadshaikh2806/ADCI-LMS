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

const navItems = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "My courses", icon: BookOpen },
  { label: "Live classes", icon: Video, badge: "2" },
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

export default function Home() {
  const backendConnected = isSupabaseConfigured();
  const [active, setActive] = useState("Overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [completed, setCompleted] = useState(false);
  const [lessonOpen, setLessonOpen] = useState(false);
  const [examOpen, setExamOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminSection, setAdminSection] = useState("Dashboard");
  const [profileOpen, setProfileOpen] = useState(false);
  const [courseStatus, setCourseStatus] = useState("In review");
  const [examStarted, setExamStarted] = useState(false);
  const [examSubmitted, setExamSubmitted] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [flagged, setFlagged] = useState<number[]>([]);
  const [secondsLeft, setSecondsLeft] = useState(40 * 60);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem("adci-learning-state");
    if (saved) {
      try {
        const state = JSON.parse(saved);
        setCompleted(Boolean(state.completed));
        setAnswers(state.answers ?? {});
        setFlagged(state.flagged ?? []);
        setSecondsLeft(state.secondsLeft ?? 40 * 60);
        setCourseStatus(state.courseStatus ?? "In review");
      } catch {
        // Ignore damaged browser state and start from the safe default.
      }
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) {
      window.localStorage.setItem("adci-learning-state", JSON.stringify({ completed, answers, flagged, secondsLeft, courseStatus }));
    }
  }, [completed, answers, flagged, secondsLeft, courseStatus, hydrated]);

  useEffect(() => {
    if (!examStarted || examSubmitted || secondsLeft <= 0) return;
    const timer = window.setInterval(() => setSecondsLeft((value) => value - 1), 1000);
    return () => window.clearInterval(timer);
  }, [examStarted, examSubmitted, secondsLeft]);

  useEffect(() => {
    if (examStarted && secondsLeft === 0) setExamSubmitted(true);
  }, [examStarted, secondsLeft]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  const correctCount = Object.entries(answers).filter(([index, value]) => examQuestions[Number(index)].answer === value).length;
  const incorrectCount = Object.entries(answers).filter(([index, value]) => examQuestions[Number(index)].answer !== value).length;
  const finalScore = Math.max(0, correctCount * 2 - incorrectCount * 0.66);

  return (
    <main className="app-shell">
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><GraduationCap size={22} /></div>
          <div><strong>ADCI</strong><span>Learning Hub</span></div>
        </div>

        <nav aria-label="Main navigation">
          <p className="nav-label">LEARN</p>
          {navItems.map(({ label, icon: Icon, badge }) => (
            <button key={label} className={`nav-item ${active === label ? "active" : ""}`} onClick={() => { if (label === "Assessments") setExamOpen(true); else setActive(label); setMenuOpen(false); }}>
              <Icon size={19} strokeWidth={1.8} /><span>{label}</span>{badge && <em>{badge}</em>}
            </button>
          ))}
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
              <span>AS</span>
              <div><strong>Aanya Sharma</strong><small>UPSC Foundation</small></div>
              <ChevronRight size={16} />
            </button>
            {profileOpen && <div className="profile-menu"><button className="selected"><GraduationCap size={17} /><span><strong>Learner portal</strong><small>Continue studying</small></span><Check size={15} /></button><button onClick={() => { setAdminOpen(true); setProfileOpen(false); }}><UserCog size={17} /><span><strong>Admin workspace</strong><small>Manage the institution</small></span><ArrowRight size={15} /></button></div>}
          </div>
        </header>

        <div className="content">
          <div className="welcome">
            <div>
              <p className="eyebrow">SUNDAY, 26 JULY</p>
              <h1>Good morning, Aanya.</h1>
              <p>You’re building momentum. Let’s make today count.</p>
            </div>
            <div className="streak"><Flame size={24} fill="currentColor" /><div><strong>12 day streak</strong><span>Personal best: 18 days</span></div></div>
          </div>

          <section className="hero-card">
            <div className="hero-copy">
              <div className="status-row"><span className="pill"><Play size={12} fill="currentColor" /> CONTINUE LEARNING</span><span>12 min left</span></div>
              <p className="hero-kicker">INDIAN POLITY · MODULE 06</p>
              <h2>Understanding the Basic Structure Doctrine</h2>
              <p>Explore how landmark judgements shaped the constitutional balance between Parliament and the judiciary.</p>
              <div className="hero-actions">
                <button className="primary" onClick={() => setLessonOpen(true)}><Play size={16} fill="currentColor" /> Resume lesson</button>
                <button className={`save ${completed ? "saved" : ""}`} onClick={() => { setCompleted(!completed); notify(completed ? "Removed from completed" : "Marked as complete"); }}>
                  <Check size={17} /> {completed ? "Completed" : "Mark complete"}
                </button>
              </div>
            </div>
            <div className="lesson-art" aria-hidden="true">
              <div className="art-grid" />
              <div className="monument"><span /><span /><span /><span /><i /></div>
              <div className="topic-tag">CONSTITUTIONAL LAW</div>
            </div>
          </section>

          <section className="metrics" aria-label="Learning progress">
            <article><div className="metric-icon amber"><Target size={20} /></div><div><span>Weekly goal</span><strong>6h 20m <small>/ 8h</small></strong></div><div className="mini-progress"><i style={{ width: "79%" }} /></div><em>79%</em></article>
            <article><div className="metric-icon green"><Trophy size={20} /></div><div><span>Practice accuracy</span><strong>78%</strong></div><div className="trend">↑ 6% this week</div></article>
            <article><div className="metric-icon blue"><ClipboardCheck size={20} /></div><div><span>Tests completed</span><strong>14</strong></div><div className="trend">2 due this week</div></article>
            <article><div className="metric-icon purple"><Clock3 size={20} /></div><div><span>Learning time</span><strong>42h</strong></div><div className="trend">Top 12% of cohort</div></article>
          </section>

          <div className="main-grid">
            <section>
              <div className="section-title"><div><h3>Continue your courses</h3><p>Pick up where you left off.</p></div><button onClick={() => setActive("My courses")}>View all <ArrowRight size={15} /></button></div>
              <div className="course-list">
                {courses.map((course) => (
                  <article className="course-card" key={course.title}>
                    <div className={`course-cover ${course.accent}`}><span>{course.code}</span><BookOpen size={25} /></div>
                    <div className="course-info"><h4>{course.title}</h4><p>{course.meta}</p><div className="progress-line"><i style={{ width: `${course.progress}%` }} /></div></div>
                    <strong className="percent">{course.progress}%</strong>
                    <button className="circle-button" aria-label={`Open ${course.title}`} onClick={() => course.code === "POLITY" ? setLessonOpen(true) : notify(`${course.title} workspace is next in the build queue`)}><ChevronRight size={19} /></button>
                  </article>
                ))}
              </div>
            </section>

            <aside className="today-card">
              <div className="section-title"><div><h3>Today’s schedule</h3><p>3 activities · 2h 10m</p></div><button className="more"><MoreHorizontal size={20} /></button></div>
              <div className="timeline">
                {schedule.map(({ time, suffix, title, teacher, type, icon: Icon, live }) => (
                  <div className="event" key={title}>
                    <div className="event-time"><strong>{time}</strong><span>{suffix}</span></div>
                    <div className={`event-dot ${live ? "is-live" : ""}`}><Icon size={16} /></div>
                    <div className="event-copy"><div><span>{type}</span>{live && <em>LIVE</em>}</div><h4>{title}</h4><p>{teacher}</p></div>
                    <button onClick={() => live ? notify("Joining live classroom…") : type === "Assessment" ? setExamOpen(true) : notify(`${type} opened`)}>{live ? "Join" : <ChevronRight size={18} />}</button>
                  </div>
                ))}
              </div>
              <button className="calendar-button" onClick={() => setActive("Study plan")}><CalendarDays size={17} /> Open full calendar</button>
            </aside>
          </div>
        </div>

        <nav className="mobile-nav" aria-label="Mobile navigation">
          {navItems.slice(0, 4).map(({ label, icon: Icon }) => <button key={label} className={active === label ? "active" : ""} onClick={() => label === "Assessments" ? setExamOpen(true) : setActive(label)}><Icon size={20} /><span>{label === "Live classes" ? "Live" : label}</span></button>)}
        </nav>
      </section>

      {active !== "Overview" && !lessonOpen && (
        <div className="route-overlay">
          <button className="overlay-close" onClick={() => setActive("Overview")}><X /></button>
          <div className="overlay-icon">{(() => { const item = navItems.find((n) => n.label === active); const Icon = item?.icon ?? BookOpen; return <Icon size={30} />; })()}</div>
          <p className="eyebrow">ADCI LEARNING HUB</p>
          <h2>{active}</h2>
          <p>This module is mapped into the product architecture and ready for its data integration sprint.</p>
          <button className="primary" onClick={() => setActive("Overview")}><ArrowRight size={17} /> Back to dashboard</button>
        </div>
      )}

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

      {examOpen && (
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
              <h1>Strong work, Aanya.</h1>
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
            <div className="admin-user"><span>AK</span><div><strong>Anees Kutty</strong><small>Super administrator</small></div><button onClick={() => setAdminOpen(false)} aria-label="Return to learner portal"><X size={17} /></button></div>
          </aside>
          <section className="admin-workspace">
            <header className="admin-topbar"><div><p className="eyebrow">ADCI · KOCHI MAIN BRANCH</p><h1>{adminSection}</h1></div><div><span className={`data-mode ${backendConnected ? "connected" : ""}`}><i />{backendConnected ? "Supabase connected" : "Demo data"}</span><button className="icon-button"><Bell size={20} /><i /></button><button className="admin-avatar">AK</button></div></header>
            {adminSection === "Dashboard" ? (
              <div className="admin-content">
                <div className="admin-welcome"><div><h2>Good morning, Anees.</h2><p>Here’s what needs your attention across the institution.</p></div><button className="primary" onClick={() => setAdminSection("Academics")}><Plus size={17} /> Create content</button></div>
                <section className="admin-metrics">
                  <article><span>ACTIVE LEARNERS</span><strong>1,284</strong><p><em>↑ 8.4%</em> from last month</p></article>
                  <article><span>LIVE ATTENDANCE</span><strong>87%</strong><p><em>↑ 3.1%</em> this week</p></article>
                  <article><span>COURSE COMPLETION</span><strong>64%</strong><p>Across 18 programmes</p></article>
                  <article><span>AT-RISK LEARNERS</span><strong>42</strong><p><b>12 need action today</b></p></article>
                </section>
                <div className="admin-grid">
                  <section className="operations-card">
                    <div className="section-title"><div><h3>Enrolment and engagement</h3><p>Last 7 days · all programmes</p></div><button>View report <ArrowRight size={15} /></button></div>
                    <div className="chart-bars">{[44,58,49,72,65,83,74].map((height,index)=><div key={index}><i style={{height:`${height}%`}} /><span>{["MON","TUE","WED","THU","FRI","SAT","SUN"][index]}</span></div>)}</div>
                    <div className="chart-summary"><div><span>New enrolments</span><strong>86</strong></div><div><span>Learning sessions</span><strong>3,492</strong></div><div><span>Avg. study time</span><strong>46 min</strong></div></div>
                  </section>
                  <section className="attention-card"><div className="section-title"><div><h3>Needs attention</h3><p>Prioritised by impact</p></div><button><MoreHorizontal size={20} /></button></div>
                    {[["12","At-risk learners","Inactive for 7+ days","red"],["3","Courses awaiting approval","Academic review queue","amber"],["8","Overdue payments","₹42,500 outstanding","blue"]].map(([count,title,detail,color])=><button key={title} onClick={() => title.includes("Courses") ? setAdminSection("Academics") : notify(`${title} queue opened`)}><span className={color}>{count}</span><div><strong>{title}</strong><small>{detail}</small></div><ChevronRight size={17} /></button>)}
                  </section>
                </div>
                <section className="recent-table"><div className="section-title"><div><h3>Recent activity</h3><p>Latest operational changes</p></div><button onClick={() => setAdminSection("Audit log")}>Full audit log <ArrowRight size={15} /></button></div>
                  <div className="table-head"><span>ACTIVITY</span><span>ACTOR</span><span>TIME</span><span>STATUS</span></div>
                  {[["Polity Module 06 submitted for review","Dr. Meera Iyer","8 min ago","In review"],["Batch UPSC-F26 learner import","Anees Kutty","34 min ago","Completed"],["Sectional Test 04 results released","System automation","1h ago","Published"]].map(row=><div className="table-row" key={row[0]}><strong>{row[0]}</strong><span>{row[1]}</span><span>{row[2]}</span><em>{row[3]}</em></div>)}
                </section>
              </div>
            ) : adminSection === "Academics" ? (
              <div className="admin-content">
                <div className="admin-welcome"><div><h2>Academic content</h2><p>Govern programmes, modules and publishing approvals.</p></div><button className="primary" onClick={() => notify("New course draft created")}><Plus size={17} /> New course</button></div>
                <div className="cms-toolbar"><div className="search"><Search size={18} /><input placeholder="Search courses and modules…" /></div><button>All programmes <ChevronRight size={15} /></button><button>All statuses <ChevronRight size={15} /></button></div>
                <section className="cms-list">
                  {[["Indian Polity & Governance","UPSC Foundation · 24 lessons",courseStatus,"Dr. Meera Iyer","72%"],["Modern Indian History","UPSC Foundation · 20 lessons","Published","Prof. Raghav Menon","100%"],["Economy & Development","UPSC Foundation · 18 lessons","Draft","Kavya Nair","38%"]].map(([title,meta,status,owner,progress])=><article key={title}><div className="cms-cover"><BookOpen size={22} /></div><div><h3>{title}</h3><p>{meta}</p><span>Owner: {owner}</span></div><div className="cms-progress"><span>CONTENT READY</span><strong>{progress}</strong><i><b style={{width:progress}} /></i></div><em className={`status-${status.toLowerCase().replace(" ","-")}`}>{status}</em>{title.startsWith("Indian") ? <button className="review-button" onClick={() => { setCourseStatus(courseStatus === "Published" ? "In review" : "Published"); notify(courseStatus === "Published" ? "Course returned to review" : "Course approved and published"); }}>{courseStatus === "Published" ? "Unpublish" : "Review & publish"}</button> : <button className="circle-button"><MoreHorizontal size={17} /></button>}</article>)}
                </section>
                <div className="workflow-note"><ShieldCheck size={20} /><div><strong>Governed publishing workflow</strong><p>Authors create drafts, academic leads review changes, and every publication or rollback is recorded in the audit log.</p></div></div>
              </div>
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
