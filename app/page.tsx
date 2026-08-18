"use client";

import Image from "next/image";
import {
  ArrowRight,
  Award,
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  CreditCard,
  Flame,
  GraduationCap,
  History,
  LayoutDashboard,
  LoaderCircle,
  Menu,
  MessageSquareText,
  Megaphone,
  MoreHorizontal,
  Play,
  ShieldCheck,
  ShoppingBag,
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
import AdminAnnouncements from "../components/AdminAnnouncements";
import AdminAssignments from "../components/AdminAssignments";
import AdminCertificates from "../components/AdminCertificates";
import AdminCommunity from "../components/AdminCommunity";
import AdminCommerce from "../components/AdminCommerce";
import AdminSupportInbox from "../components/AdminSupportInbox";
import AccountSettings from "../components/AccountSettings";
import AdciLogo from "../components/AdciLogo";
import NotificationCenter from "../components/NotificationCenter";
import GlobalLearningSearch from "../components/GlobalLearningSearch";
import ThemeToggle from "../components/ThemeToggle";
import { PersistentAgoraClassroom } from "../components/AgoraClassroom";
import StudentQuizRunner from "../components/StudentQuizRunner";
import LiveClassSchedule from "../components/LiveClassSchedule";
import StudentLiveClasses from "../components/StudentLiveClasses";
import StudentAssessmentCentre from "../components/StudentAssessmentCentre";
import HelpCentre from "../components/HelpCentre";
import LearnerOnboarding from "../components/LearnerOnboarding";
import StudentCourses from "../components/StudentCourses";
import StudentCoursePlayer from "../components/StudentCoursePlayer";
import StudyPlan from "../components/StudyPlan";
import StudentAssignments from "../components/StudentAssignments";
import StudentCertificates from "../components/StudentCertificates";
import CommunityHub from "../components/CommunityHub";
import StudentCommerce from "../components/StudentCommerce";
import { hasAcademicAdminRole, loadMyAdciMemberships } from "../lib/supabase/admin";
import { getLearnerDashboard, getMyNotifications, type AdciNotification, type LearnerDashboard } from "../lib/supabase/learning";
import type { LearningSearchResult } from "../lib/supabase/search";

const navItems = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "My courses", icon: BookOpen },
  { label: "Live classes", icon: Video },
  { label: "Assessments", icon: ClipboardCheck },
  { label: "Assignments", icon: ClipboardList },
  { label: "Certificates", icon: Award },
  { label: "Programmes", icon: ShoppingBag },
  { label: "Study plan", icon: CalendarDays },
  { label: "Community", icon: Users }
];

const learnerDestinations = new Set([
  ...navItems.map((item) => item.label),
  "Help centre",
  "Settings"
]);

type SavedLearningState = {
  userId?: string;
  destination?: string;
  workspace?: "learner" | "admin";
  adminSection?: string;
};

function getSavedLearningState(userId?: string): SavedLearningState | null {
  if (!userId || typeof window === "undefined") return null;
  try {
    const saved = JSON.parse(window.localStorage.getItem("adci-learning-state") || "null") as SavedLearningState | null;
    return saved?.userId === userId ? saved : null;
  } catch {
    return null;
  }
}

function getSavedLearnerDestination(userId?: string) {
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("offer")) return "Programmes";
  const saved = getSavedLearningState(userId);
  return saved?.destination && learnerDestinations.has(saved.destination) ? saved.destination : "Overview";
}

const adminNavItems = [
  { label: "Dashboard", icon: LayoutDashboard, roles: ["super_admin", "branch_admin", "academic_lead", "content_author"] },
  { label: "People", icon: UsersRound, roles: ["super_admin", "branch_admin", "support"] },
  { label: "Academics", icon: BookOpen, roles: ["super_admin", "branch_admin", "academic_lead", "content_author"] },
  { label: "Question bank", icon: ClipboardCheck, roles: ["super_admin", "branch_admin", "academic_lead", "content_author"] },
  { label: "Assignments", icon: ClipboardList, roles: ["super_admin", "branch_admin", "academic_lead", "content_author", "instructor"] },
  { label: "Certificates", icon: Award, roles: ["super_admin", "branch_admin", "academic_lead"] },
  { label: "Commerce", icon: CreditCard, roles: ["super_admin", "branch_admin", "finance"] },
  { label: "Support", icon: CircleHelp, roles: ["super_admin", "branch_admin", "support", "mentor"] },
  { label: "Community", icon: MessageSquareText, roles: ["super_admin", "branch_admin", "support", "mentor", "instructor"] },
  { label: "Live schedule", icon: CalendarDays, roles: ["super_admin", "branch_admin", "academic_lead", "content_author"] },
  { label: "Announcements", icon: Megaphone, roles: ["super_admin", "branch_admin", "academic_lead", "content_author", "support"] },
  { label: "Reports", icon: BarChart3, roles: ["super_admin", "branch_admin", "academic_lead"] },
  { label: "Audit log", icon: History, roles: ["super_admin", "branch_admin"] }
];

function LearningHub() {
  const backendConnected = isSupabaseConfigured();
  const authSession = useAuthSession();
  const accountName = authSession?.user.user_metadata?.full_name || authSession?.user.email?.split("@")[0] || "ADCI Learner";
  const accountInitials = accountName.split(/\s+/).slice(0, 2).map((part: string) => part[0]).join("").toUpperCase();
  const [savedLearningState] = useState(() => getSavedLearningState(authSession?.user.id));
  const initialDestination = getSavedLearnerDestination(authSession?.user.id);
  const [active, setActive] = useState(() => navItems.some((item) => item.label === initialDestination) ? initialDestination : "Overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [examOpen, setExamOpen] = useState(false);
  const [activeAssessmentId, setActiveAssessmentId] = useState("");
  const [assessmentCentreKey, setAssessmentCentreKey] = useState(0);
  const [activeAssignmentId, setActiveAssignmentId] = useState("");
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminSection, setAdminSection] = useState("Dashboard");
  const [profileOpen, setProfileOpen] = useState(false);
  const [canAdminister, setCanAdminister] = useState(false);
  const [rolesLoaded, setRolesLoaded] = useState(false);
  const [adminEntrySection, setAdminEntrySection] = useState("Dashboard");
  const [dashboard, setDashboard] = useState<LearnerDashboard | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState("");
  const [openLearning, setOpenLearning] = useState<{ courseId: string; lessonId?: string } | null>(null);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(() => initialDestination === "Settings");
  const [helpOpen, setHelpOpen] = useState(() => initialDestination === "Help centre");
  const [helpCategory, setHelpCategory] = useState<"mentor" | undefined>();
  const [helpTicketId, setHelpTicketId] = useState("");
  const [adminRoles, setAdminRoles] = useState<string[]>([]);

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
    if (!authSession?.user.id || !rolesLoaded) return;
    const destination = settingsOpen ? "Settings" : helpOpen ? "Help centre" : active;
    window.localStorage.setItem("adci-learning-state", JSON.stringify({
      userId: authSession.user.id,
      destination,
      workspace: adminOpen ? "admin" : "learner",
      adminSection
    }));
  }, [active, adminOpen, adminSection, authSession?.user.id, helpOpen, rolesLoaded, settingsOpen]);

  useEffect(() => {
    if (!authSession) return;
    getMyNotifications()
      .then((notifications) => setNotificationCount(notifications.unread_count))
      .catch(() => setNotificationCount(0));
  }, [authSession]);

  useEffect(() => {
    if (!authSession) return;
    let active = true;
    let workspaceRestored = false;
    async function loadRole() {
      try {
        const memberships = await loadMyAdciMemberships();
        if (active) {
          const mayAdminister = hasAcademicAdminRole(memberships);
          setCanAdminister(mayAdminister);
          const roles = new Set(memberships.map((membership) => membership.role));
          setAdminRoles([...roles]);
          const entrySection =
            roles.has("super_admin") || roles.has("branch_admin") || roles.has("academic_lead") || roles.has("content_author")
              ? "Dashboard"
              : roles.has("finance") ? "Commerce"
              : roles.has("support") || roles.has("mentor") ? "Support"
              : roles.has("instructor") ? "Assignments"
              : "Community";
          setAdminEntrySection(entrySection);
          if (!workspaceRestored && mayAdminister && savedLearningState?.workspace === "admin") {
            const savedSection = adminNavItems.find((item) => item.label === savedLearningState.adminSection && item.roles.some((role) => roles.has(role)))?.label;
            setAdminSection(savedSection ?? entrySection);
            setAdminOpen(true);
            workspaceRestored = true;
          }
          setRolesLoaded(true);
        }
      } catch {
        if (active) {
          setCanAdminister(false);
          setRolesLoaded(true);
        }
      }
    }
    void loadRole();
    const retry = window.setTimeout(loadRole, 1800);
    return () => { active = false; window.clearTimeout(retry); };
  }, [authSession, savedLearningState?.adminSection, savedLearningState?.workspace]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  function openSearchResult(result: LearningSearchResult) {
    setProfileOpen(false);
    setSettingsOpen(false);
    setNotificationOpen(false);
    setMenuOpen(false);
    if (result.result_type === "quiz") {
      setActiveAssessmentId(result.id);
      setExamOpen(true);
      return;
    }
    if (result.result_type === "assignment") {
      setActiveAssignmentId(result.id);
      setActive("Assignments");
      return;
    }
    setActive("Overview");
    setOpenLearning({
      courseId: result.course_id,
      lessonId: result.result_type === "lesson" ? result.lesson_id ?? undefined : undefined
    });
  }

  function openNotificationAction(notification: AdciNotification) {
    const action = notification.action_data;
    setProfileOpen(false);
    setSettingsOpen(false);
    setMenuOpen(false);
    if (action.kind === "support") {
      setHelpCategory(undefined);
      setHelpTicketId(action.id ?? "");
      setHelpOpen(true);
      return;
    }
    if (action.kind === "assignment") {
      setActiveAssignmentId(action.id ?? "");
      setActive("Assignments");
      return;
    }
    if (action.kind === "assessment") {
      setActiveAssessmentId(action.id ?? "");
      setExamOpen(true);
      return;
    }
    if (action.kind === "live_class") {
      if (action.course_id && action.lesson_id) {
        setActive("Overview");
        setOpenLearning({ courseId: action.course_id, lessonId: action.lesson_id });
      } else {
        setActive("Live classes");
      }
    }
  }

  function openAdminWorkspace() {
    setProfileOpen(false);
    setSettingsOpen(false);
    setAdminSection(adminEntrySection);
    setAdminOpen(true);
  }

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
          <div className="brand-mark"><AdciLogo decorative /></div>
          <div><strong>ADCI</strong><span>Learning Hub</span></div>
        </div>

        <nav aria-label="Main navigation">
          <p className="nav-label">LEARN</p>
          {navItems.map(({ label, icon: Icon }) => {
            const badge = label === "Live classes" && (dashboard?.upcoming_live_count ?? 0) > 0
              ? String(dashboard?.upcoming_live_count)
              : "";
            return <button key={label} className={`nav-item ${active === label && !settingsOpen && !helpOpen ? "active" : ""}`} onClick={() => { setActive(label); setSettingsOpen(false); setHelpOpen(false); setMenuOpen(false); }}>
              <Icon size={19} strokeWidth={1.8} /><span>{label}</span>{badge && <em>{badge}</em>}
            </button>;
          })}
        </nav>

        <div className="sidebar-bottom">
          <button className={`nav-item ${helpOpen ? "active" : ""}`} onClick={() => { setSettingsOpen(false); setHelpCategory(undefined); setHelpTicketId(""); setHelpOpen(true); setMenuOpen(false); }}><CircleHelp size={19} /><span>Help centre</span></button>
          <button className={`nav-item ${settingsOpen ? "active" : ""}`} onClick={() => { setHelpOpen(false); setSettingsOpen(true); setMenuOpen(false); }}><Settings size={19} /><span>Settings</span></button>
          <div className="mentor-card">
            <div className="mentor-icon"><Sparkles size={20} /></div>
            <strong>Need a study nudge?</strong>
            <p>Your mentor is available today.</p>
            <button onClick={() => { setSettingsOpen(false); setHelpCategory("mentor"); setHelpTicketId(""); setHelpOpen(true); }}>Message mentor <ArrowRight size={14} /></button>
          </div>
        </div>
      </aside>

      {menuOpen && <button className="scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}

      <section className="workspace">
        <header className="topbar">
          <button className="menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Open menu">{menuOpen ? <X /> : <Menu />}</button>
          <GlobalLearningSearch openResult={openSearchResult} />
          <div className="top-actions">
            <ThemeToggle />
            <button className="icon-button" aria-label={`${notificationCount} unread notifications`} onClick={() => setNotificationOpen(true)}><Bell size={20} />{notificationCount > 0 && <><i /><span className="notification-count">{notificationCount > 99 ? "99+" : notificationCount}</span></>}</button>
            <button className="profile" onClick={() => setProfileOpen(!profileOpen)}>
              <span>{accountInitials}</span>
              <div><strong>{accountName}</strong><small>UPSC Foundation</small></div>
              <ChevronRight size={16} />
            </button>
            {profileOpen && <div className="profile-menu"><button className="selected"><GraduationCap size={17} /><span><strong>Learner portal</strong><small>Continue studying</small></span><Check size={15} /></button>{canAdminister && <button onClick={() => void openAdminWorkspace()}><UserCog size={17} /><span><strong>Admin workspace</strong><small>Role-protected administration</small></span><ArrowRight size={15} /></button>}<button onClick={() => { setSettingsOpen(true); setProfileOpen(false); }}><Settings size={17} /><span><strong>Account settings</strong><small>Profile, security and sign out</small></span><ArrowRight size={15} /></button></div>}
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

            {!dashboardLoading && !dashboardError && (dashboard?.courses.length ?? 0) === 0 && <LearnerOnboarding
              emailVerified={Boolean(authSession?.user.email_confirmed_at)}
              profileComplete={Boolean(authSession?.user.user_metadata?.full_name?.trim())}
              openSettings={() => setSettingsOpen(true)}
              openProgrammes={() => setActive("Programmes")}
              openHelp={() => { setHelpTicketId(""); setHelpCategory(undefined); setHelpOpen(true); }}
            />}

            <section className="hero-card">
            <div className="hero-copy">
              <div className="status-row"><span className="pill"><Play size={12} fill="currentColor" /> {continueLesson ? "CONTINUE LEARNING" : "MY LEARNING"}</span><span>{continueLesson ? (continueLesson.lesson_type === "video" || continueLesson.lesson_type === "audio" ? `${Math.max(1, Math.ceil((continueLesson.duration_seconds - continueLesson.position_seconds) / 60))} min left` : continueLesson.lesson_type.replace("html", "article")) : `${dashboard?.courses.length ?? 0} courses`}</span></div>
              <p className="hero-kicker">{continueLesson ? `${continueLesson.course_title} · ${continueLesson.module_title}` : "ANEES DEFENCE CAREER INSTITUTE"}</p>
              <h2>{continueLesson?.lesson_title ?? (dashboardLoading ? "Loading your next lesson…" : "Your learning journey starts here")}</h2>
              <p>{continueLesson ? `Resume your ${continueLesson.lesson_type} lesson from ${continueLesson.progress_percent}% progress.` : "Open My courses to begin a published course assigned by your administrator."}</p>
              <div className="hero-actions">
                <button className="primary" disabled={!continueLesson} onClick={() => continueLesson && setOpenLearning({ courseId: continueLesson.course_id, lessonId: continueLesson.lesson_id })}>{dashboardLoading ? <LoaderCircle size={16} className="spin" /> : <Play size={16} fill="currentColor" />} {dashboardLoading ? "Loading…" : continueLesson ? "Resume lesson" : "No lesson available"}</button>
                <button className="save" onClick={() => setActive("My courses")}><BookOpen size={17} /> View my courses</button>
              </div>
            </div>
            <div className="lesson-art" aria-hidden="true">
              <Image src="/images/adci-defence-career-hero.webp" alt="" fill priority sizes="(max-width: 760px) 100vw, 42vw" />
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
              <button className="calendar-button" onClick={() => setActive("Live classes")}><CalendarDays size={17} /> Open full schedule</button>
            </aside>
          </div>
        </div>

        <nav className="mobile-nav" aria-label="Mobile navigation">
          {navItems.slice(0, 4).map(({ label, icon: Icon }) => <button key={label} className={active === label && !settingsOpen && !helpOpen ? "active" : ""} onClick={() => { setActive(label); setSettingsOpen(false); setHelpOpen(false); }}><Icon size={20} /><span>{label === "Live classes" ? "Live" : label}</span></button>)}
          {canAdminister && <button className="mobile-admin-entry" onClick={() => void openAdminWorkspace()}><UserCog size={20} /><span>Admin</span></button>}
        </nav>
      </section>

      {active === "My courses" && <StudentCourses close={() => { setActive("Overview"); void refreshLearnerDashboard(); }} notify={notify} />}
      {active === "Live classes" && <StudentLiveClasses close={() => setActive("Overview")} notify={notify} openLesson={(courseId, lessonId) => setOpenLearning({ courseId, lessonId })} />}
      {active === "Assessments" && <StudentAssessmentCentre key={assessmentCentreKey} close={() => setActive("Overview")} openAssessment={(assessmentId) => { setActiveAssessmentId(assessmentId); setExamOpen(true); }} />}
      {active === "Study plan" && <StudyPlan close={() => setActive("Overview")} notify={notify} openAssessments={(assessmentId) => { setActiveAssessmentId(assessmentId); setExamOpen(true); }} />}
      {active === "Assignments" && <StudentAssignments initialAssignmentId={activeAssignmentId || undefined} close={() => { setActiveAssignmentId(""); setActive("Overview"); }} notify={notify} />}
      {active === "Certificates" && <StudentCertificates close={() => setActive("Overview")} />}
      {active === "Programmes" && <StudentCommerce close={() => { setActive("Overview"); void refreshLearnerDashboard(); }} notify={notify} />}
      {active === "Community" && <CommunityHub close={() => setActive("Overview")} notify={notify} />}
      {openLearning && <StudentCoursePlayer
        courseId={openLearning.courseId}
        initialLessonId={openLearning.lessonId}
        notify={notify}
        close={() => {
          setOpenLearning(null);
          void refreshLearnerDashboard();
        }}
      />}

      {examOpen && <StudentQuizRunner assessmentId={activeAssessmentId || undefined} close={() => { setExamOpen(false); setActiveAssessmentId(""); setAssessmentCentreKey((value) => value + 1); void refreshLearnerDashboard(); }} />}
      {adminOpen && (
        <div className="admin-app">
          <aside className="admin-sidebar">
            <div className="brand"><div className="brand-mark"><AdciLogo decorative /></div><div><strong>ADCI</strong><span>Administration</span></div></div>
            <p className="nav-label">WORKSPACE</p>
            {adminNavItems.filter((item) => item.roles.some((role) => adminRoles.includes(role))).map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${adminSection === label ? "active" : ""}`} onClick={() => setAdminSection(label)}><Icon size={18} /><span>{label}</span></button>)}
            <div className="admin-user"><span>{accountInitials}</span><div><strong>{accountName}</strong><small>{adminRoles.map((role) => role.replaceAll("_", " ")).join(" · ") || "Administrator"}</small></div><button onClick={() => setAdminOpen(false)} aria-label="Return to learner portal"><X size={17} /></button></div>
          </aside>
          <section className="admin-workspace">
              <header className="admin-topbar"><div><p className="eyebrow">ANEES DEFENCE CAREER INSTITUTE</p><h1>{adminSection}</h1></div><div><span className={`data-mode ${backendConnected ? "connected" : ""}`}><i />{backendConnected ? "Supabase connected" : "Configuration required"}</span><ThemeToggle /><button className="icon-button" aria-label={`${notificationCount} unread notifications`} onClick={() => setNotificationOpen(true)}><Bell size={20} />{notificationCount > 0 && <><i /><span className="notification-count">{notificationCount > 99 ? "99+" : notificationCount}</span></>}</button><button className="admin-avatar" onClick={() => { setAdminOpen(false); setSettingsOpen(true); }} aria-label="Open account settings" title="Account settings">{accountInitials}</button><button className="admin-mobile-exit" onClick={() => setAdminOpen(false)} aria-label="Return to learner portal" title="Return to learner portal"><X size={18} /></button></div></header>
            {adminSection === "Dashboard" ? (
              <AdminDashboard accountName={accountName} navigate={setAdminSection} />
            ) : adminSection === "Academics" ? (
              <AdminCourseManager notify={notify} />
            ) : adminSection === "People" ? (
              <AdminPeopleManager notify={notify} currentRoles={adminRoles} />
            ) : adminSection === "Reports" ? (
              <AdminReports notify={notify} />
            ) : adminSection === "Live schedule" ? (
              <AdminLiveSchedule notify={notify} openAcademics={() => setAdminSection("Academics")} />
            ) : adminSection === "Question bank" ? (
              <AdminQuestionBank notify={notify} />
            ) : adminSection === "Assignments" ? (
              <AdminAssignments notify={notify} />
            ) : adminSection === "Certificates" ? (
              <AdminCertificates notify={notify} />
            ) : adminSection === "Commerce" ? (
              <AdminCommerce notify={notify} />
            ) : adminSection === "Support" ? (
              <AdminSupportInbox notify={notify} />
            ) : adminSection === "Community" ? (
              <AdminCommunity notify={notify} />
            ) : adminSection === "Announcements" ? (
              <AdminAnnouncements notify={notify} />
            ) : adminSection === "Audit log" ? (
              <AdminAuditLog notify={notify} />
            ) : null}
          </section>
        </div>
      )}

      {notificationOpen && <NotificationCenter close={() => setNotificationOpen(false)} onUnreadChange={setNotificationCount} onOpenAction={openNotificationAction} />}
      {settingsOpen && <AccountSettings close={() => setSettingsOpen(false)} notify={notify} onMfaChanged={(enabled) => { if (!enabled) setAdminOpen(false); }} />}
      {helpOpen && <HelpCentre initialCategory={helpCategory} initialTicketId={helpTicketId || undefined} close={() => { setHelpOpen(false); setHelpCategory(undefined); setHelpTicketId(""); }} notify={notify} />}
      <PersistentAgoraClassroom notify={notify} userId={authSession?.user.id || ""} />
      {toast && <div className="toast"><Check size={17} />{toast}</div>}
    </main>
  );
}

export default function Home() {
  return <AuthGate><LearningHub /></AuthGate>;
}
