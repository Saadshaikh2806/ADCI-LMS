"use client";

import { AlarmClock, ArrowRight, Check, ClipboardCheck, Flag, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "../lib/supabase/client";

type Quiz = {
  id: string;
  title: string;
  duration_seconds: number;
  positive_marks: number;
  negative_marks: number;
  pass_percent: number;
  questions: Array<{ id: string; prompt: string; options: string[]; position: number }>;
};
type Result = { score: number; max_score: number; correct: number; incorrect: number; unanswered: number; passed: boolean };

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
  const [attemptId, setAttemptId] = useState("");
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [flagged, setFlagged] = useState<number[]>([]);
  const [seconds, setSeconds] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    supabase.rpc("adci_get_available_quizzes").then(({ data, error: loadError }) => {
      if (loadError) setError(loadError.message);
      else {
        const quizzes = (data as Quiz[]) ?? [];
        setQuiz((assessmentId ? quizzes.find((item) => item.id === assessmentId) : quizzes[0]) ?? null);
      }
      setLoading(false);
    });
  }, [assessmentId]);

  useEffect(() => {
    if (!attemptId || seconds <= 0 || result) return;
    const timer = window.setInterval(() => setSeconds((value) => value - 1), 1000);
    return () => window.clearInterval(timer);
  }, [attemptId, seconds, result]);

  async function start() {
    if (!quiz) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    setError("");
    const { data, error: startError } = await supabase.rpc("adci_start_quiz_attempt", { target_assessment_id: quiz.id });
    if (startError) { setError(startError.message); return; }
    setAttemptId((data as { id: string }).id);
    setSeconds(quiz.duration_seconds);
  }

  async function answer(index: number) {
    if (!quiz || !attemptId) return;
    setAnswers((value) => ({ ...value, [current]: index }));
    const supabase = getSupabaseBrowserClient();
    await supabase?.rpc("adci_save_quiz_answer", {
      target_attempt_id: attemptId,
      target_question_id: quiz.questions[current].id,
      answer_index: index,
      review_flag: flagged.includes(current)
    });
  }

  async function submit() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !attemptId) return;
    const { data, error: submitError } = await supabase.rpc("adci_submit_quiz_attempt", { target_attempt_id: attemptId });
    if (submitError) setError(submitError.message);
    else {
      setResult(data as Result);
      onCompleted?.();
    }
  }

  if (loading) return <div className="exam-room"><div className="auth-loading"><LoaderCircle className="spin" /> Loading assessments…</div></div>;
  if (!quiz) return <div className="exam-room"><section className="exam-intro"><button className="overlay-close" onClick={close}><X /></button><div className="exam-badge"><ClipboardCheck /></div><h1>No published quizzes</h1><p>{error || "Your instructor has not published an assessment yet."}</p></section></div>;

  return <div className="exam-room">
    {!attemptId ? <section className="exam-intro"><button className="overlay-close" onClick={close}><X /></button><div className="exam-badge"><ClipboardCheck /></div><p className="eyebrow">ONLINE QUIZ</p><h1>{quiz.title}</h1><p>This assessment is scored securely and every answer is saved to your account.</p><div className="exam-rules"><div><AlarmClock /><span><strong>{Math.round(quiz.duration_seconds / 60)} minutes</strong><small>Timed attempt</small></span></div><div><ClipboardCheck /><span><strong>{quiz.questions.length} questions</strong><small>Single-choice MCQ</small></span></div><div><ShieldCheck /><span><strong>+{quiz.positive_marks} / -{quiz.negative_marks}</strong><small>Marking scheme</small></span></div><div><Check /><span><strong>{quiz.pass_percent}% to pass</strong><small>Required score</small></span></div></div>{error && <div className="course-error">{error}</div>}<button className="primary start-exam" onClick={() => void start()}>Start quiz <ArrowRight /></button></section>
    : result ? <section className="result-panel"><button className="overlay-close" onClick={close}><X /></button><div className="result-ring"><span><strong>{result.score}</strong>/ {result.max_score}</span></div><p className="eyebrow">{result.passed ? "QUIZ PASSED" : "KEEP PRACTISING"}</p><h1>{result.passed ? "Well done." : "Review and try again."}</h1><div className="result-stats"><div><span>Correct</span><strong>{result.correct}</strong></div><div><span>Incorrect</span><strong>{result.incorrect}</strong></div><div><span>Unanswered</span><strong>{result.unanswered}</strong></div><div><span>Status</span><strong>{result.passed ? "Pass" : "Retry"}</strong></div></div><button className="primary" onClick={close}>Return to dashboard</button></section>
    : <><header className="exam-header"><div><ClipboardCheck /><span><strong>{quiz.title}</strong><small>Answers save automatically</small></span></div><div className="exam-timer"><AlarmClock /><span>{String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}</span></div><button onClick={() => void submit()}>Submit quiz</button></header><div className="exam-layout"><section className="question-panel"><div className="question-meta"><span>QUESTION {current + 1} OF {quiz.questions.length}</span><em>+{quiz.positive_marks} · -{quiz.negative_marks}</em></div><h2>{quiz.questions[current].prompt}</h2><div className="options">{quiz.questions[current].options.map((option, index) => <button key={option} className={answers[current] === index ? "selected" : ""} onClick={() => void answer(index)}><span>{String.fromCharCode(65 + index)}</span><strong>{option}</strong>{answers[current] === index && <Check />}</button>)}</div><div className="question-actions"><button className={flagged.includes(current) ? "flagged" : ""} onClick={() => setFlagged((items) => items.includes(current) ? items.filter((item) => item !== current) : [...items, current])}><Flag /> Flag for review</button><div><button disabled={current === 0} onClick={() => setCurrent((value) => value - 1)}>Previous</button><button className="primary" onClick={() => current === quiz.questions.length - 1 ? void submit() : setCurrent((value) => value + 1)}>{current === quiz.questions.length - 1 ? "Finish" : "Save & next"} <ArrowRight /></button></div></div></section><aside className="question-palette"><p className="eyebrow">QUESTIONS</p><div className="palette-grid">{quiz.questions.map((question, index) => <button key={question.id} className={`${current === index ? "current" : ""} ${answers[index] !== undefined ? "answered" : ""}`} onClick={() => setCurrent(index)}>{index + 1}</button>)}</div></aside></div></>}
  </div>;
}
