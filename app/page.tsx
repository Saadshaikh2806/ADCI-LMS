"use client";

import {
  ArrowRight,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  Flame,
  GraduationCap,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  Play,
  Search,
  Settings,
  Sparkles,
  Target,
  Trophy,
  Users,
  Video,
  X
} from "lucide-react";
import { useState } from "react";

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

export default function Home() {
  const [active, setActive] = useState("Overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [completed, setCompleted] = useState(false);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

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
            <button key={label} className={`nav-item ${active === label ? "active" : ""}`} onClick={() => { setActive(label); setMenuOpen(false); }}>
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
            <button className="profile">
              <span>AS</span>
              <div><strong>Aanya Sharma</strong><small>UPSC Foundation</small></div>
              <ChevronRight size={16} />
            </button>
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
                <button className="primary" onClick={() => notify("Lesson resumed at 18:42")}><Play size={16} fill="currentColor" /> Resume lesson</button>
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
                    <button className="circle-button" aria-label={`Open ${course.title}`} onClick={() => notify(`${course.title} opened`)}><ChevronRight size={19} /></button>
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
                    <button onClick={() => notify(live ? "Joining live classroom…" : `${type} opened`)}>{live ? "Join" : <ChevronRight size={18} />}</button>
                  </div>
                ))}
              </div>
              <button className="calendar-button" onClick={() => setActive("Study plan")}><CalendarDays size={17} /> Open full calendar</button>
            </aside>
          </div>
        </div>

        <nav className="mobile-nav" aria-label="Mobile navigation">
          {navItems.slice(0, 4).map(({ label, icon: Icon }) => <button key={label} className={active === label ? "active" : ""} onClick={() => setActive(label)}><Icon size={20} /><span>{label === "Live classes" ? "Live" : label}</span></button>)}
        </nav>
      </section>

      {active !== "Overview" && (
        <div className="route-overlay">
          <button className="overlay-close" onClick={() => setActive("Overview")}><X /></button>
          <div className="overlay-icon">{(() => { const item = navItems.find((n) => n.label === active); const Icon = item?.icon ?? BookOpen; return <Icon size={30} />; })()}</div>
          <p className="eyebrow">ADCI LEARNING HUB</p>
          <h2>{active}</h2>
          <p>This module is mapped into the product architecture and ready for its data integration sprint.</p>
          <button className="primary" onClick={() => setActive("Overview")}><ArrowRight size={17} /> Back to dashboard</button>
        </div>
      )}

      {toast && <div className="toast"><Check size={17} />{toast}</div>}
    </main>
  );
}
