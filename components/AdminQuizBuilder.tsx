"use client";

import { LoaderCircle, Plus, Save, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  addAdciQuizQuestion,
  deleteAdciQuizQuestion,
  getAdciQuizEditor,
  saveAdciQuiz,
  type AdciQuizEditor
} from "../lib/supabase/admin";

export default function AdminQuizBuilder({ lessonId, lessonTitle, close, notify }: {
  lessonId: string;
  lessonTitle: string;
  close: () => void;
  notify: (message: string) => void;
}) {
  const [quiz, setQuiz] = useState<AdciQuizEditor | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState(lessonTitle);
  const [minutes, setMinutes] = useState("20");
  const [positive, setPositive] = useState("1");
  const [negative, setNegative] = useState("0");
  const [passPercent, setPassPercent] = useState("40");
  const [status, setStatus] = useState("draft");
  const [prompt, setPrompt] = useState("");
  const [options, setOptions] = useState(["", "", "", ""]);
  const [correct, setCorrect] = useState(0);
  const [explanation, setExplanation] = useState("");

  async function refresh() {
    setLoading(true);
    try {
      const data = await getAdciQuizEditor(lessonId);
      setQuiz(data);
      if (data) {
        setTitle(data.title);
        setMinutes(String(Math.round(data.duration_seconds / 60)));
        setPositive(String(data.positive_marks));
        setNegative(String(data.negative_marks));
        setPassPercent(String(data.pass_percent));
        setStatus(data.status);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load quiz");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [lessonId]);

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      await saveAdciQuiz({
        lessonId, title, durationSeconds: Math.max(60, Number(minutes) * 60),
        positiveMarks: Number(positive), negativeMarks: Number(negative),
        passPercent: Number(passPercent), status
      });
      await refresh();
      notify("Quiz settings saved");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save quiz");
    } finally { setSaving(false); }
  }

  async function addQuestion(event: React.FormEvent) {
    event.preventDefault();
    if (!quiz) { setError("Save quiz settings before adding questions."); return; }
    const cleanOptions = options.map((option) => option.trim()).filter(Boolean);
    if (cleanOptions.length < 2 || correct >= cleanOptions.length) {
      setError("Provide at least two options and select the correct answer.");
      return;
    }
    setSaving(true); setError("");
    try {
      await addAdciQuizQuestion(quiz.id, prompt, cleanOptions, correct, explanation);
      setPrompt(""); setOptions(["", "", "", ""]); setCorrect(0); setExplanation("");
      await refresh();
      notify("Question added");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to add question");
    } finally { setSaving(false); }
  }

  return (
    <div className="course-dialog-backdrop">
      <div className="quiz-builder">
        <div className="course-dialog-head"><div><p className="eyebrow">QUIZ BUILDER</p><h2>{lessonTitle}</h2></div><button onClick={close}><X /></button></div>
        {loading ? <div className="cms-loading"><LoaderCircle className="spin" /> Loading quiz…</div> : (
          <div className="quiz-builder-grid">
            <form className="quiz-settings-card" onSubmit={saveSettings}>
              <h3>Settings</h3>
              <label><span>Quiz title</span><input required value={title} onChange={(e) => setTitle(e.target.value)} /></label>
              <div><label><span>Minutes</span><input min="1" type="number" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label><label><span>Pass %</span><input min="0" max="100" type="number" value={passPercent} onChange={(e) => setPassPercent(e.target.value)} /></label></div>
              <div><label><span>Correct marks</span><input min="0" step=".01" type="number" value={positive} onChange={(e) => setPositive(e.target.value)} /></label><label><span>Negative marks</span><input min="0" step=".01" type="number" value={negative} onChange={(e) => setNegative(e.target.value)} /></label></div>
              <label><span>Status</span><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="draft">Draft</option><option value="published">Published</option><option value="retired">Retired</option></select></label>
              <button className="primary" disabled={saving}><Save size={15} /> Save settings</button>
            </form>
            <section className="quiz-question-workspace">
              <div className="quiz-question-list"><h3>Questions <small>{quiz?.adci_assessment_questions.length ?? 0}</small></h3>{quiz?.adci_assessment_questions.map((item) => <article key={item.adci_questions.id}><span>{item.position}</span><div><strong>{item.adci_questions.prompt}</strong>{item.adci_questions.options.map((option, index) => <small key={option} className={index === item.adci_questions.correct_answer.index ? "correct" : ""}>{String.fromCharCode(65 + index)}. {option}</small>)}</div><button onClick={() => void deleteAdciQuizQuestion(quiz.id, item.adci_questions.id).then(refresh)}><Trash2 size={14} /></button></article>)}</div>
              <form className="question-creator" onSubmit={addQuestion}><h3>Add MCQ</h3><label><span>Question</span><textarea required value={prompt} onChange={(e) => setPrompt(e.target.value)} /></label>{options.map((option, index) => <label className="option-editor" key={index}><input type="radio" name="correct" checked={correct === index} onChange={() => setCorrect(index)} /><input required={index < 2} value={option} onChange={(e) => setOptions((current) => current.map((value, optionIndex) => optionIndex === index ? e.target.value : value))} placeholder={`Option ${String.fromCharCode(65 + index)}`} /></label>)}<label><span>Explanation (optional)</span><textarea value={explanation} onChange={(e) => setExplanation(e.target.value)} /></label><button className="primary" disabled={saving}><Plus size={15} /> Add question</button></form>
            </section>
          </div>
        )}
        {error && <div className="course-error">{error}</div>}
      </div>
    </div>
  );
}
