"use client";

import { AlarmClock, ArrowRight, Check, ClipboardCheck, Flag, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "../lib/supabase/client";
import ContentProtection from "./ContentProtection";

type QuizQuestion = { id: string; prompt: string; options: string[]; position: number };
type Quiz = {
  id: string;
  title: string;
  duration_seconds: number;
  positive_marks: number;
  negative_marks: number;
  pass_percent: number;
  questions: QuizQuestion[];
};
type Result = {
  attempt_id: string;
  score: number;
  max_score: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  passed: boolean;
  timed_out: boolean;
  attempts_used: number;
  max_attempts: number;
};
type SavedAnswer = { question_id: string; answer_index: number | null; flagged: boolean };
type AttemptState = {
  attempts_used: number;
  max_attempts: number;
  can_start: boolean;
  active_attempt: null | {
    id: string;
    server_started_at: string;
    server_deadline_at: string;
    answers: SavedAnswer[];
  };
  expired_result: Result | null;
  latest_result: Result | null;
};

export default function StudentQuizRunner({
  close,
  assessmentId,
  onCompleted
}: {
  close: () => void;
  assessmentId?: string;
  onCompleted?: () => void;
}) {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [attemptId, setAttemptId] = useState("");
  const [deadline, setDeadline] = useState("");
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [flagged, setFlagged] = useState<number[]>([]);
  const [seconds, setSeconds] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [attemptsUsed, setAttemptsUsed] = useState(0);
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [canStart, setCanStart] = useState(true);
  const [savingCount, setSavingCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [proctorReady, setProctorReady] = useState(false);
  const [watermark, setWatermark] = useState("AUTHORISED LEARNER");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const pendingSaves = useRef<Set<Promise<void>>>(new Set());
  const submittingRef = useRef(false);
  const autoSubmittedRef = useRef(false);
  const integrityViolationRef = useRef(false);

  useEffect(() => {
    void getSupabaseBrowserClient()?.auth.getUser().then(({ data }) => {
      if (data.user) setWatermark(data.user.email || data.user.id);
    });
  }, []);

  function applyAttemptState(selectedQuiz: Quiz, state: AttemptState) {
    setAttemptsUsed(state.attempts_used ?? 0);
    setMaxAttempts(state.max_attempts ?? 1);
    setCanStart(Boolean(state.can_start));

    if (state.active_attempt) {
      const restoredAnswers: Record<number, number> = {};
      const restoredFlags: number[] = [];
      state.active_attempt.answers.forEach((saved) => {
        const questionIndex = selectedQuiz.questions.findIndex((question) => question.id === saved.question_id);
        if (questionIndex < 0) return;
        if (typeof saved.answer_index === "number") restoredAnswers[questionIndex] = saved.answer_index;
        if (saved.flagged) restoredFlags.push(questionIndex);
      });
      const restoredDeadline = state.active_attempt.server_deadline_at;
      const restoredSeconds = Math.max(0, Math.ceil((new Date(restoredDeadline).getTime() - Date.now()) / 1000));
      setAttemptId(state.active_attempt.id);
      setDeadline(restoredDeadline);
      setSeconds(restoredSeconds);
      setAnswers(restoredAnswers);
      setFlagged(restoredFlags);
      const firstUnanswered = selectedQuiz.questions.findIndex((_, index) => restoredAnswers[index] === undefined);
      setCurrent(firstUnanswered >= 0 ? firstUnanswered : 0);
      setNotice("Your active attempt was restored. The original timer is still running.");
      return;
    }

    const completedResult = state.expired_result || (!state.can_start ? state.latest_result : null);
    if (completedResult) {
      setAttemptId(completedResult.attempt_id);
      setResult(completedResult);
      if (state.expired_result) setNotice("Time expired while you were away. Your saved answers were submitted automatically.");
    }
  }

  async function loadAttemptState(selectedQuiz: Quiz) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return false;
    const { data, error: stateError } = await supabase.rpc("adci_get_quiz_attempt_state", {
      target_assessment_id: selectedQuiz.id
    });
    if (stateError) {
      setError(stateError.message);
      return false;
    }
    applyAttemptState(selectedQuiz, data as AttemptState);
    return true;
  }

  useEffect(() => {
    let active = true;
    async function loadQuiz() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        if (active) {
          setError("The learning service is not configured.");
          setLoading(false);
        }
        return;
      }

      const { data, error: loadError } = await supabase.rpc("adci_get_available_quizzes");
      if (!active) return;
      if (loadError) {
        setError(loadError.message);
        setLoading(false);
        return;
      }

      const quizzes = (data as Quiz[]) ?? [];
      const selected = (assessmentId ? quizzes.find((item) => item.id === assessmentId) : quizzes[0]) ?? null;
      setQuiz(selected);
      if (selected) await loadAttemptState(selected);
      if (active) setLoading(false);
    }
    void loadQuiz();
    return () => { active = false; };
  }, [assessmentId]);

  useEffect(() => {
    if (!attemptId || !deadline || result) return;
    const updateTimer = () => {
      const remaining = Math.max(0, Math.ceil((new Date(deadline).getTime() - Date.now()) / 1000));
      setSeconds(remaining);
    };
    updateTimer();
    const timer = window.setInterval(updateTimer, 500);
    return () => window.clearInterval(timer);
  }, [attemptId, deadline, result]);

  useEffect(() => {
    if (!attemptId || !deadline || result || seconds > 0 || autoSubmittedRef.current) return;
    autoSubmittedRef.current = true;
    void submit(true);
  }, [attemptId, deadline, result, seconds]);

  function trackSave(operation: Promise<void>) {
    pendingSaves.current.add(operation);
    setSavingCount((value) => value + 1);
    void operation.finally(() => {
      pendingSaves.current.delete(operation);
      setSavingCount((value) => Math.max(0, value - 1));
    });
  }

  async function enterFullscreen() {
    if (!document.fullscreenEnabled) {
      setError("This browser does not support the fullscreen mode required for tests.");
      return false;
    }
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      integrityViolationRef.current = false;
      setProctorReady(true);
      setError("");
      return true;
    } catch {
      setError("Fullscreen permission is required. Allow fullscreen, then try again.");
      return false;
    }
  }

  async function start() {
    if (!quiz || starting || !canStart) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    if (!await enterFullscreen()) return;
    setStarting(true);
    setError("");
    setNotice("");
    setResult(null);
    autoSubmittedRef.current = false;
    const { data, error: startError } = await supabase.rpc("adci_start_quiz_attempt", {
      target_assessment_id: quiz.id
    });
    if (startError) {
      setProctorReady(false);
      if (document.fullscreenElement) await document.exitFullscreen();
      setError(startError.message);
      setStarting(false);
      return;
    }

    const attempt = data as { id: string; server_deadline_at: string };
    setAttemptId(attempt.id);
    setDeadline(attempt.server_deadline_at);
    setSeconds(Math.max(0, Math.ceil((new Date(attempt.server_deadline_at).getTime() - Date.now()) / 1000)));
    setAnswers({});
    setFlagged([]);
    setCurrent(0);
    const stateLoaded = await loadAttemptState(quiz);
    if (stateLoaded) setNotice("Quiz started in protected fullscreen mode. Leaving it will submit the test.");
    setStarting(false);
  }

  async function handleIntegrityViolation(reason: string) {
    if (integrityViolationRef.current || !attemptId || result) return;
    integrityViolationRef.current = true;
    setNotice(`The test was submitted automatically because ${reason}.`);
    await submit(true);
  }

  async function answer(index: number) {
    if (!quiz || !attemptId || submittingRef.current || seconds <= 0) return;
    const questionIndex = current;
    const previous = answers[questionIndex];
    setAnswers((value) => ({ ...value, [questionIndex]: index }));
    setError("");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    const operation = (async () => {
      const { error: saveError } = await supabase.rpc("adci_save_quiz_answer", {
        target_attempt_id: attemptId,
        target_question_id: quiz.questions[questionIndex].id,
        answer_index: index,
        review_flag: flagged.includes(questionIndex)
      });
      if (!saveError) return;
      setAnswers((value) => {
        if (value[questionIndex] !== index) return value;
        const restored = { ...value };
        if (previous === undefined) delete restored[questionIndex];
        else restored[questionIndex] = previous;
        return restored;
      });
      setError(`Question ${questionIndex + 1} was not saved: ${saveError.message}`);
    })();
    trackSave(operation);
  }

  async function toggleFlag() {
    if (!quiz || !attemptId || submittingRef.current || seconds <= 0) return;
    const questionIndex = current;
    const wasFlagged = flagged.includes(questionIndex);
    const nextFlag = !wasFlagged;
    setFlagged((items) => nextFlag ? [...items, questionIndex] : items.filter((item) => item !== questionIndex));
    setError("");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    const operation = (async () => {
      const { error: saveError } = await supabase.rpc("adci_save_quiz_flag", {
        target_attempt_id: attemptId,
        target_question_id: quiz.questions[questionIndex].id,
        review_flag: nextFlag
      });
      if (!saveError) return;
      setFlagged((items) => wasFlagged
        ? Array.from(new Set([...items, questionIndex]))
        : items.filter((item) => item !== questionIndex));
      setError(`Review flag was not saved: ${saveError.message}`);
    })();
    trackSave(operation);
  }

  async function submit(automatic = false) {
    if (!attemptId || submittingRef.current) return;
    if (!automatic) {
      const unanswered = Math.max(0, (quiz?.questions.length ?? 0) - Object.keys(answers).length);
      const message = unanswered > 0
        ? `You still have ${unanswered} unanswered question${unanswered === 1 ? "" : "s"}. Submit now?`
        : "Submit this quiz now? You cannot change answers afterward.";
      if (!window.confirm(message)) return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    await Promise.all(Array.from(pendingSaves.current));
    const { data, error: submitError } = await supabase.rpc("adci_submit_quiz_attempt", {
      target_attempt_id: attemptId
    });
    if (submitError) {
      setError(submitError.message);
      integrityViolationRef.current = false;
      submittingRef.current = false;
      setSubmitting(false);
      return;
    }

    const completed = data as Result;
    setResult(completed);
    setAttemptsUsed(completed.attempts_used);
    setMaxAttempts(completed.max_attempts);
    setCanStart(completed.attempts_used < completed.max_attempts);
    integrityViolationRef.current = true;
    setProctorReady(false);
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    setSubmitting(false);
    submittingRef.current = false;
    onCompleted?.();
  }

  if (loading) {
    return <div className="exam-room"><div className="auth-loading"><LoaderCircle className="spin" /> Loading assessments…</div></div>;
  }

  if (!quiz) {
    return <div className="exam-room"><section className="exam-intro">
      <button className="overlay-close" onClick={close}><X /></button>
      <div className="exam-badge"><ClipboardCheck /></div>
      <h1>No published quizzes</h1>
      <p>{error || "Your instructor has not published an assessment yet."}</p>
    </section></div>;
  }

  return <div className="exam-room protected-session">
    <ContentProtection
      watermark={watermark}
      strict
      concealWhenInactive
      active={Boolean(attemptId && !result && proctorReady)}
      onViolation={(reason) => void handleIntegrityViolation(reason)}
    />
    {result ? <section className="result-panel">
      <button className="overlay-close" onClick={close}><X /></button>
      <div className="result-ring" style={{ background: `conic-gradient(#e5a346 ${result.max_score > 0 ? Math.max(0, Math.min(100, result.score / result.max_score * 100)) : 0}%,#eeeae1 0)` }}><span><strong>{result.score}</strong>/ {result.max_score}</span></div>
      <p className="eyebrow">{result.timed_out ? "TIME COMPLETED" : result.passed ? "QUIZ PASSED" : "QUIZ COMPLETED"}</p>
      <h1>{result.passed ? "Well done." : "Review and keep practising."}</h1>
      {notice && <div className="exam-notice">{notice}</div>}
      <div className="result-stats">
        <div><span>Correct</span><strong>{result.correct}</strong></div>
        <div><span>Incorrect</span><strong>{result.incorrect}</strong></div>
        <div><span>Unanswered</span><strong>{result.unanswered}</strong></div>
        <div><span>Attempts</span><strong>{result.attempts_used} / {result.max_attempts}</strong></div>
      </div>
      <button className="primary" onClick={close}>Return to dashboard</button>
    </section> : !attemptId ? <section className="exam-intro">
      <button className="overlay-close" onClick={close}><X /></button>
      <div className="exam-badge"><ClipboardCheck /></div>
      <p className="eyebrow">ONLINE QUIZ</p>
      <h1>{quiz.title}</h1>
      <p>This assessment is timed by the server. Every answer is saved and the same attempt resumes after a refresh.</p>
      <div className="exam-rules">
        <div><AlarmClock /><span><strong>{Math.round(quiz.duration_seconds / 60)} minutes</strong><small>Server-timed attempt</small></span></div>
        <div><ClipboardCheck /><span><strong>{quiz.questions.length} questions</strong><small>Single-choice MCQ</small></span></div>
        <div><ShieldCheck /><span><strong>+{quiz.positive_marks} / -{quiz.negative_marks}</strong><small>Marking scheme</small></span></div>
        <div><Check /><span><strong>{attemptsUsed} / {maxAttempts} used</strong><small>{quiz.pass_percent}% required to pass</small></span></div>
      </div>
      <div className="integrity-note"><ShieldCheck /><p><strong>Protected test:</strong> fullscreen is required. Switching tabs, changing windows, exiting fullscreen or trying to leave will submit the attempt automatically.</p></div>
      {notice && <div className="exam-notice">{notice}</div>}
      {error && <div className="course-error">{error}</div>}
      <button className="primary start-exam" disabled={starting || !canStart || quiz.questions.length === 0} onClick={() => void start()}>
        {starting ? <><LoaderCircle className="spin" /> Starting…</> : canStart ? <>Start quiz <ArrowRight /></> : "Maximum attempts reached"}
      </button>
    </section> : !proctorReady ? <section className="exam-intro">
      <div className="exam-badge"><ShieldCheck /></div>
      <p className="eyebrow">ACTIVE TEST</p>
      <h1>Resume in fullscreen</h1>
      <p>Your server timer is still running. The questions stay hidden until the protected fullscreen session is restored.</p>
      {notice && <div className="exam-notice">{notice}</div>}
      {error && <div className="course-error">{error}</div>}
      <button className="primary start-exam" onClick={() => void enterFullscreen()}>Resume test <ArrowRight /></button>
    </section> : <>
      <header className="exam-header">
        <div><ClipboardCheck /><span><strong>{quiz.title}</strong><small>{savingCount > 0 ? "Saving answer…" : "All answers saved"}</small></span></div>
        <div className={`exam-timer ${seconds < 300 ? "warning" : ""}`}><AlarmClock /><span>{String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}</span></div>
        <button disabled={submitting} onClick={() => void submit()}>{submitting ? "Submitting…" : "Submit quiz"}</button>
      </header>
      {notice && <div className="exam-session-message">{notice}</div>}
      {error && <div className="exam-session-message error">{error}</div>}
      <div className="exam-layout">
        <section className="question-panel">
          <div className="question-meta"><span>QUESTION {current + 1} OF {quiz.questions.length}</span><em>+{quiz.positive_marks} · -{quiz.negative_marks}</em></div>
          <h2>{quiz.questions[current].prompt}</h2>
          <div className="options">
            {quiz.questions[current].options.map((option, index) => <button key={`${index}-${option}`} disabled={submitting || seconds <= 0} className={answers[current] === index ? "selected" : ""} onClick={() => void answer(index)}>
              <span>{String.fromCharCode(65 + index)}</span><strong>{option}</strong>{answers[current] === index && <Check />}
            </button>)}
          </div>
          <div className="question-actions">
            <button disabled={submitting || seconds <= 0} className={flagged.includes(current) ? "flagged" : ""} onClick={() => void toggleFlag()}><Flag /> {flagged.includes(current) ? "Flagged for review" : "Flag for review"}</button>
            <div>
              <button disabled={current === 0 || submitting} onClick={() => setCurrent((value) => value - 1)}>Previous</button>
              <button disabled={submitting} className="primary" onClick={() => current === quiz.questions.length - 1 ? void submit() : setCurrent((value) => value + 1)}>{current === quiz.questions.length - 1 ? "Finish" : "Save & next"} <ArrowRight /></button>
            </div>
          </div>
        </section>
        <aside className="question-palette">
          <p className="eyebrow">QUESTIONS</p>
          <div className="palette-grid">{quiz.questions.map((question, index) => <button key={question.id} className={`${current === index ? "current" : ""} ${answers[index] !== undefined ? "answered" : ""} ${flagged.includes(index) ? "flagged" : ""}`} onClick={() => setCurrent(index)}>{index + 1}</button>)}</div>
          <div className="palette-legend"><span><i className="answered" />Answered</span><span><i />Not answered</span><span><i className="flagged" />Review</span></div>
          <div className="save-status"><ShieldCheck /><span><strong>{savingCount > 0 ? "Saving changes" : "Attempt protected"}</strong><small>{savingCount > 0 ? "Please keep this window open." : "You can safely refresh and resume."}</small></span></div>
          <div className="exam-lock-note"><ShieldCheck /><span><strong>Fullscreen locked</strong><small>Leaving this screen submits the test.</small></span></div>
        </aside>
      </div>
    </>}
  </div>;
}
