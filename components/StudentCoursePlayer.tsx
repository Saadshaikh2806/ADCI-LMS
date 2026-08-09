"use client";

import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  CirclePlay,
  Clock3,
  FileAudio,
  FileText,
  LoaderCircle,
  LockKeyhole,
  Play,
  Radio,
  ShieldCheck,
  Video
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  getLearningCourse,
  getProtectedLessonUrl,
  saveLessonProgress,
  type LearningCourse,
  type LearningLesson
} from "../lib/supabase/learning";
import { getSupabaseBrowserClient } from "../lib/supabase/client";
import ContentProtection from "./ContentProtection";
import StudentQuizRunner from "./StudentQuizRunner";

const lessonTypeNames: Record<LearningLesson["lesson_type"], string> = {
  video: "Recorded lecture",
  audio: "Audio lesson",
  pdf: "PDF reading",
  html: "Article",
  live: "Live class",
  quiz: "Quiz"
};

const liveProviderNames = {
  zoom: "Zoom",
  google_meet: "Google Meet",
  youtube_live: "YouTube Live"
};

function durationLabel(seconds: number) {
  if (!seconds) return "Self paced";
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

export default function StudentCoursePlayer({
  courseId,
  close,
  notify,
  initialLessonId
}: {
  courseId: string;
  close: () => void;
  notify: (message: string) => void;
  initialLessonId?: string;
}) {
  const [course, setCourse] = useState<LearningCourse | null>(null);
  const [selectedLessonId, setSelectedLessonId] = useState("");
  const [assetUrl, setAssetUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [assetLoading, setAssetLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [joining, setJoining] = useState(false);
  const [quizAssessmentId, setQuizAssessmentId] = useState("");
  const [watermark, setWatermark] = useState("AUTHORISED LEARNER");
  const [error, setError] = useState("");

  useEffect(() => {
    void getSupabaseBrowserClient()?.auth.getUser().then(({ data }) => {
      if (data.user) setWatermark(data.user.email || data.user.id);
    });
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getLearningCourse(courseId)
      .then((loadedCourse) => {
        if (!active) return;
        setCourse(loadedCourse);
        const loadedLessons = loadedCourse.modules.flatMap((module) => module.lessons);
        setSelectedLessonId(
          loadedLessons.find((lesson) => lesson.id === initialLessonId)?.id
          ?? (loadedLessons.find((lesson) => !lesson.completed) ?? loadedLessons[0])?.id
          ?? ""
        );
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Unable to open course");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [courseId, initialLessonId]);

  const lessons = useMemo(
    () => course?.modules.flatMap((module) => module.lessons) ?? [],
    [course]
  );
  const selectedLesson = lessons.find((lesson) => lesson.id === selectedLessonId) ?? null;
  const selectedIndex = selectedLesson ? lessons.findIndex((lesson) => lesson.id === selectedLesson.id) : -1;
  const completedCount = lessons.filter((lesson) => lesson.completed).length;
  const courseProgress = lessons.length ? Math.round((completedCount / lessons.length) * 100) : 0;

  useEffect(() => {
    let active = true;
    setAssetUrl("");
    setError("");
    if (!selectedLesson?.asset) {
      setAssetLoading(false);
      return;
    }
    setAssetLoading(true);
    getProtectedLessonUrl(selectedLesson.id, selectedLesson.asset)
      .then((url) => {
        if (active) setAssetUrl(url);
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Unable to open protected file");
      })
      .finally(() => {
        if (active) setAssetLoading(false);
      });
    return () => { active = false; };
  }, [selectedLesson?.id, selectedLesson?.asset]);

  function updateLessonProgress(lessonId: string, completed: boolean, progressPercent = 100, positionSeconds = 0) {
    setCourse((currentCourse) => currentCourse ? {
      ...currentCourse,
      modules: currentCourse.modules.map((module) => ({
        ...module,
        lessons: module.lessons.map((lesson) => lesson.id === lessonId ? {
          ...lesson,
          completed: lesson.completed || completed,
          progress_percent: Math.max(lesson.progress_percent, progressPercent),
          position_seconds: Math.max(lesson.position_seconds, positionSeconds)
        } : lesson)
      }))
    } : currentCourse);
  }

  async function markComplete() {
    if (!selectedLesson || selectedLesson.completed) return;
    setSaving(true);
    setError("");
    try {
      await saveLessonProgress({
        lessonId: selectedLesson.id,
        progressPercent: 100,
        positionSeconds: selectedLesson.position_seconds,
        completed: true
      });
      updateLessonProgress(selectedLesson.id, true);
      notify("Lesson completed and progress saved");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save progress");
    } finally {
      setSaving(false);
    }
  }

  async function saveMediaProgress(media: HTMLMediaElement, complete = false) {
    if (!selectedLesson || !Number.isFinite(media.duration) || media.duration <= 0) return;
    const percent = complete ? 100 : Math.min(99, Math.round(media.currentTime / media.duration * 100));
    try {
      await saveLessonProgress({
        lessonId: selectedLesson.id,
        progressPercent: percent,
        positionSeconds: Math.round(media.currentTime),
        completed: complete
      });
      updateLessonProgress(selectedLesson.id, complete, percent, Math.round(media.currentTime));
      if (complete) notify("Lesson completed and progress saved");
    } catch {
      notify("Playback continues, but progress could not be saved");
    }
  }

  async function joinLiveClass() {
    if (!selectedLesson?.live_class) return;
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
    setJoining(true);
    setError("");
    const { data, error: joinError } = await supabase.rpc("adci_join_live_class", {
      target_lesson_id: selectedLesson.id
    });
    if (joinError) {
      popup.close();
      setError(joinError.message);
    } else {
      popup.location.replace(data as string);
      notify("Attendance recorded. Opening live class.");
    }
    setJoining(false);
  }

  if (loading) return <div className="learning-room learner-player-state"><LoaderCircle className="spin" /><span>Preparing your protected course…</span></div>;
  if (!course) return <div className="learning-room learner-player-state"><BookOpen /><h2>Course unavailable</h2><p>{error || "This course could not be loaded."}</p><button className="primary" onClick={close}>Return to My courses</button></div>;

  return <div className="learning-room protected-session">
    <header className="learning-header">
      <button className="back-button" onClick={close}><ArrowRight size={18} /> My courses</button>
      <div className="learning-course-title"><strong>{course.title}</strong></div>
      <div className="secure-session"><ShieldCheck size={16} /> Progress secured</div>
    </header>
    <div className="learning-layout">
      <section className="lesson-stage dynamic-lesson-stage">
        {!selectedLesson ? <div className="empty-curriculum"><BookOpen /><h2>No lessons yet</h2><p>Your instructor is still preparing this course.</p></div> : <>
          <div className="lesson-content-frame">
            <ContentProtection watermark={watermark} concealWhenInactive />
            {assetLoading ? <div className="lesson-content-state"><LoaderCircle className="spin" /><span>Opening protected content…</span></div>
            : selectedLesson.lesson_type === "video" && assetUrl ? <video
              className="lesson-video"
              controls
              controlsList="nodownload noremoteplayback"
              disablePictureInPicture
              disableRemotePlayback
              preload="metadata"
              src={assetUrl}
              onLoadedMetadata={(event) => {
                if (selectedLesson.position_seconds > 0) event.currentTarget.currentTime = selectedLesson.position_seconds;
              }}
              onPause={(event) => void saveMediaProgress(event.currentTarget)}
              onEnded={(event) => void saveMediaProgress(event.currentTarget, true)}
            />
            : selectedLesson.lesson_type === "audio" && assetUrl ? <div className="audio-player-card"><div><FileAudio /><span><small>ADCI AUDIO LESSON</small><strong>{selectedLesson.title}</strong></span></div><audio
              controls
              controlsList="nodownload"
              preload="metadata"
              src={assetUrl}
              onLoadedMetadata={(event) => {
                if (selectedLesson.position_seconds > 0) event.currentTarget.currentTime = selectedLesson.position_seconds;
              }}
              onPause={(event) => void saveMediaProgress(event.currentTarget)}
              onEnded={(event) => void saveMediaProgress(event.currentTarget, true)}
            /></div>
            : selectedLesson.lesson_type === "pdf" && assetUrl ? <div className="pdf-reader"><iframe title={selectedLesson.title} src={`${assetUrl}#toolbar=0&navpanes=0`} /><span><FileText size={17} /> Protected PDF viewer</span></div>
            : selectedLesson.lesson_type === "html" ? <article className="article-reader"><p className="eyebrow">ADCI STUDY ARTICLE</p><h2>{selectedLesson.title}</h2><div>{selectedLesson.article_body || "This article has not been written yet."}</div></article>
            : selectedLesson.lesson_type === "live" ? <div className="live-lesson-card"><div className="live-lesson-icon"><Radio /></div><p className="eyebrow">LIVE LEARNING</p><h2>{selectedLesson.title}</h2>{selectedLesson.live_class ? <><p>{liveProviderNames[selectedLesson.live_class.provider]} with <strong>{selectedLesson.live_class.instructor_name}</strong></p><div className="live-lesson-time"><Clock3 /><span><strong>{new Date(selectedLesson.live_class.starts_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</strong><small>Ends {new Date(selectedLesson.live_class.ends_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</small></span></div><button className="primary" disabled={!selectedLesson.live_class.can_join || joining} onClick={() => void joinLiveClass()}><Video /> {joining ? "Opening…" : selectedLesson.live_class.can_join ? "Join live class" : "Join opens 15 minutes before class"}</button></> : <p>Schedule and meeting details have not been added yet.</p>}</div>
            : selectedLesson.lesson_type === "quiz" ? <div className="quiz-lesson-card"><div><CirclePlay /></div><p className="eyebrow">INTERACTIVE ASSESSMENT</p><h2>{selectedLesson.quiz?.title || selectedLesson.title}</h2><p>Start the timed quiz, save each answer securely and receive your score immediately after submission.</p><button className="primary" disabled={!selectedLesson.quiz} onClick={() => selectedLesson.quiz && setQuizAssessmentId(selectedLesson.quiz.assessment_id)}><Play fill="currentColor" /> {selectedLesson.quiz ? "Start quiz" : "Quiz is not published yet"}</button></div>
            : <div className="lesson-content-state missing"><LockKeyhole /><h2>Content is being prepared</h2><p>The lesson exists, but its protected file has not been uploaded yet.</p></div>}
          </div>

          <div className="lesson-body">
            <div className="lesson-heading">
              <div><p className="eyebrow">LESSON {selectedIndex + 1} OF {lessons.length} · {lessonTypeNames[selectedLesson.lesson_type]}</p><h1>{selectedLesson.title}</h1></div>
              <button className={`complete-large ${selectedLesson.completed ? "done" : ""}`} disabled={saving || selectedLesson.completed} onClick={() => void markComplete()}>{saving ? <LoaderCircle className="spin" /> : <Check />} {selectedLesson.completed ? "Completed" : "Mark complete"}</button>
            </div>
            <p className="lesson-summary">{course.description || "Complete this lesson to keep your ADCI learning progress up to date."}</p>
            {error && <div className="course-error">{error}</div>}
            {selectedIndex < lessons.length - 1 && <button className="next-lesson-button" onClick={() => setSelectedLessonId(lessons[selectedIndex + 1].id)}>Next lesson <ArrowRight /></button>}
          </div>
        </>}
      </section>

      <aside className="lesson-outline">
        <div className="outline-title"><div><span>COURSE CONTENT</span><h3>{course.modules.length} module{course.modules.length === 1 ? "" : "s"}</h3></div><strong>{courseProgress}%</strong></div>
        <div className="outline-progress"><i style={{ width: `${courseProgress}%` }} /></div>
        <div className="curriculum-outline">
          {course.modules.map((module) => <section key={module.id}>
            <header><span>MODULE {module.position}</span><strong>{module.title}</strong><ChevronDown /></header>
            <div className="lesson-items">
              {module.lessons.map((lesson) => <button key={lesson.id} className={selectedLessonId === lesson.id ? "current" : ""} onClick={() => setSelectedLessonId(lesson.id)}>
                <span className={`lesson-state ${lesson.completed ? "done" : ""}`}>{lesson.completed ? <Check /> : selectedLessonId === lesson.id ? <CirclePlay /> : lesson.position}</span>
                <span><strong>{lesson.title}</strong><small>{lessonTypeNames[lesson.lesson_type]}{(lesson.lesson_type === "video" || lesson.lesson_type === "audio") ? ` · ${durationLabel(lesson.duration_seconds)}` : ""}</small></span>
              </button>)}
            </div>
          </section>)}
        </div>
      </aside>
    </div>
    {quizAssessmentId && <StudentQuizRunner
      assessmentId={quizAssessmentId}
      close={() => setQuizAssessmentId("")}
      onCompleted={() => {
        if (selectedLesson) {
          void saveLessonProgress({ lessonId: selectedLesson.id, progressPercent: 100, completed: true })
            .then(() => updateLessonProgress(selectedLesson.id, true));
        }
      }}
    />}
  </div>;
}
