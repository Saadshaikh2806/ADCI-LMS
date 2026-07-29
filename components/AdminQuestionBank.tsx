"use client";

import {
  Check,
  ClipboardCheck,
  Copy,
  Download,
  FileUp,
  Layers3,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Tag,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  attachAdciBankQuestion,
  deleteAdciBankQuestion,
  getAdciQuestionBank,
  saveAdciBankQuestion,
  type AdciBankQuestion,
  type AdciQuestionBank
} from "../lib/supabase/admin";

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\"") {
      if (quoted && text[index + 1] === "\"") { cell += "\""; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell.trim()); cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; cell = "";
    } else cell += character;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export default function AdminQuestionBank({ notify }: { notify: (message: string) => void }) {
  const [bank, setBank] = useState<AdciQuestionBank | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [topicFilter, setTopicFilter] = useState("all");
  const [difficultyFilter, setDifficultyFilter] = useState("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [options, setOptions] = useState(["", "", "", ""]);
  const [correct, setCorrect] = useState(0);
  const [explanation, setExplanation] = useState("");
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [assignQuestion, setAssignQuestion] = useState<AdciBankQuestion | null>(null);
  const [assessmentId, setAssessmentId] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setBank(await getAdciQuestionBank());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load question bank");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const topics = useMemo(
    () => [...new Set((bank?.questions ?? []).map((question) => question.topic).filter(Boolean))].sort(),
    [bank]
  );
  const visibleQuestions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (bank?.questions ?? []).filter((question) =>
      (!query || question.prompt.toLowerCase().includes(query) || question.topic.toLowerCase().includes(query))
      && (topicFilter === "all" || question.topic === topicFilter)
      && (difficultyFilter === "all" || question.difficulty === difficultyFilter)
    );
  }, [bank, search, topicFilter, difficultyFilter]);

  function resetEditor() {
    setEditingId("");
    setPrompt("");
    setOptions(["", "", "", ""]);
    setCorrect(0);
    setExplanation("");
    setTopic("");
    setDifficulty("medium");
  }

  function openEditor(question?: AdciBankQuestion) {
    resetEditor();
    if (question) {
      setEditingId(question.locked ? "" : question.id);
      setPrompt(question.prompt);
      setOptions(question.options.length >= 2 ? question.options : ["", "", "", ""]);
      setCorrect(question.correct_option);
      setExplanation(question.explanation);
      setTopic(question.topic);
      setDifficulty(question.difficulty);
      if (question.locked) notify("Answered questions are duplicated to protect historical scores");
    }
    setEditorOpen(true);
    setError("");
  }

  async function saveQuestion(event: React.FormEvent) {
    event.preventDefault();
    const cleanOptions = options.map((option) => option.trim()).filter(Boolean);
    if (cleanOptions.length < 2 || correct >= cleanOptions.length) {
      setError("Provide at least two options and select a valid correct answer.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await saveAdciBankQuestion({
        id: editingId || undefined,
        prompt,
        options: cleanOptions,
        correctOption: correct,
        explanation,
        topic,
        difficulty
      });
      notify(editingId ? "Question updated" : "Question added to the bank");
      setEditorOpen(false);
      await refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save question");
    } finally {
      setSaving(false);
    }
  }

  async function removeQuestion(question: AdciBankQuestion) {
    if (!window.confirm(`Delete “${question.prompt}”?`)) return;
    setSaving(true);
    setError("");
    try {
      await deleteAdciBankQuestion(question.id);
      notify("Question deleted");
      await refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete question");
    } finally {
      setSaving(false);
    }
  }

  async function assign(event: React.FormEvent) {
    event.preventDefault();
    if (!assignQuestion || !assessmentId) return;
    setSaving(true);
    setError("");
    try {
      await attachAdciBankQuestion(assignQuestion.id, assessmentId);
      notify("Question assigned to quiz");
      setAssignQuestion(null);
      setAssessmentId("");
      await refresh();
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : "Unable to assign question");
    } finally {
      setSaving(false);
    }
  }

  function downloadTemplate() {
    const template = "prompt,option_a,option_b,option_c,option_d,correct_option,topic,difficulty,explanation\r\n\"Which service protects the Indian coastline?\",\"Indian Army\",\"Indian Navy\",\"Indian Air Force\",\"Coast Guard\",\"B\",\"General Knowledge\",\"easy\",\"The Indian Navy protects maritime interests.\"";
    const url = URL.createObjectURL(new Blob([template], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "adci-question-import-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importCsv(file: File) {
    setSaving(true);
    setError("");
    try {
      const rows = parseCsv(await file.text());
      if (rows.length < 2) throw new Error("The CSV contains no question rows");
      const headers = rows[0].map((header) => header.trim().toLowerCase());
      const column = (name: string) => headers.indexOf(name);
      const required = ["prompt", "option_a", "option_b", "correct_option"];
      if (required.some((name) => column(name) < 0)) throw new Error("Use the ADCI CSV template and keep its header row");
      let imported = 0;
      for (const row of rows.slice(1)) {
        const questionPrompt = row[column("prompt")]?.trim();
        if (!questionPrompt) continue;
        const questionOptions = ["option_a", "option_b", "option_c", "option_d", "option_e", "option_f"]
          .map((name) => column(name) >= 0 ? row[column(name)]?.trim() : "")
          .filter(Boolean);
        const answerValue = row[column("correct_option")]?.trim().toUpperCase();
        const correctIndex = /^[A-F]$/.test(answerValue)
          ? answerValue.charCodeAt(0) - 65
          : Number(answerValue) - 1;
        if (questionOptions.length < 2 || correctIndex < 0 || correctIndex >= questionOptions.length) {
          throw new Error(`Invalid options or correct answer in row ${imported + 2}`);
        }
        const rawDifficulty = column("difficulty") >= 0 ? row[column("difficulty")]?.trim().toLowerCase() : "medium";
        await saveAdciBankQuestion({
          prompt: questionPrompt,
          options: questionOptions,
          correctOption: correctIndex,
          explanation: column("explanation") >= 0 ? row[column("explanation")] ?? "" : "",
          topic: column("topic") >= 0 ? row[column("topic")] ?? "" : "",
          difficulty: rawDifficulty === "easy" || rawDifficulty === "hard" ? rawDifficulty : "medium"
        });
        imported += 1;
      }
      notify(`${imported} question${imported === 1 ? "" : "s"} imported`);
      await refresh();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Unable to import questions");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
      setSaving(false);
    }
  }

  if (loading && !bank) return <div className="admin-report-state"><LoaderCircle className="spin" /><span>Loading reusable questions…</span></div>;
  if (error && !bank) return <div className="admin-report-state error"><ClipboardCheck /><h2>Question bank unavailable</h2><p>{error}</p><button onClick={() => void refresh()}><RefreshCw /> Retry</button></div>;

  return <div className="admin-content question-bank-workspace">
    <div className="admin-welcome question-bank-heading">
      <div><h2>Question bank</h2><p>Create once, reuse across quizzes and protect historical learner scores.</p></div>
      <div><input ref={fileInput} hidden type="file" accept=".csv,text/csv" onChange={(event) => event.target.files?.[0] && void importCsv(event.target.files[0])} /><button onClick={downloadTemplate}><Download /> CSV template</button><button onClick={() => fileInput.current?.click()} disabled={saving}><FileUp /> Import CSV</button><button className="primary" onClick={() => openEditor()}><Plus /> New question</button></div>
    </div>
    {error && <div className="course-error">{error}</div>}

    <section className="question-bank-metrics">
      <article><div><ClipboardCheck /></div><span>TOTAL QUESTIONS</span><strong>{bank?.summary.total ?? 0}</strong></article>
      <article><div className="used"><Layers3 /></div><span>USED IN QUIZZES</span><strong>{bank?.summary.used ?? 0}</strong></article>
      <article><div className="unused"><Copy /></div><span>AVAILABLE TO USE</span><strong>{bank?.summary.unused ?? 0}</strong></article>
      <article><div className="topics"><Tag /></div><span>TOPICS</span><strong>{bank?.summary.topics ?? 0}</strong></article>
    </section>

    <section className="question-bank-card">
      <div className="question-bank-toolbar"><label><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search question or topic" /></label><select value={topicFilter} onChange={(event) => setTopicFilter(event.target.value)}><option value="all">All topics</option>{topics.map((item) => <option key={item}>{item}</option>)}</select><select value={difficultyFilter} onChange={(event) => setDifficultyFilter(event.target.value)}><option value="all">All difficulties</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select><span>{visibleQuestions.length} question{visibleQuestions.length === 1 ? "" : "s"}</span></div>
      <div className="bank-question-list">
        {visibleQuestions.map((question, questionIndex) => <article key={question.id}>
          <div className="bank-question-number">{questionIndex + 1}</div>
          <div className="bank-question-copy"><div><span>{question.topic || "General"}</span><em className={`difficulty-${question.difficulty}`}>{question.difficulty}</em><small>v{question.version}</small>{question.locked && <small className="locked">Score locked</small>}</div><h3>{question.prompt}</h3><div className="bank-options">{question.options.map((option, index) => <span key={`${option}-${index}`} className={index === question.correct_option ? "correct" : ""}><i>{String.fromCharCode(65 + index)}</i>{option}{index === question.correct_option && <Check />}</span>)}</div>{question.explanation && <p><strong>Explanation:</strong> {question.explanation}</p>}<footer><span><Layers3 /> Used in {question.usage_count} quiz{question.usage_count === 1 ? "" : "zes"}</span>{question.assessments.slice(0, 3).map((assessment) => <em key={assessment.id}>{assessment.title}</em>)}</footer></div>
          <div className="bank-question-actions"><button onClick={() => { setAssignQuestion(question); setAssessmentId(bank?.assessments[0]?.id ?? ""); }}><Plus /> Assign</button><button title={question.locked ? "Duplicate question" : "Edit question"} onClick={() => openEditor(question)}>{question.locked ? <Copy /> : <Pencil />}</button><button className="delete" disabled={question.usage_count > 0 || question.locked || saving} title={question.usage_count > 0 ? "Remove from quizzes before deleting" : "Delete question"} onClick={() => void removeQuestion(question)}><Trash2 /></button></div>
        </article>)}
        {visibleQuestions.length === 0 && <div className="report-empty"><ClipboardCheck /> No questions match these filters.</div>}
      </div>
    </section>

    {editorOpen && <div className="course-dialog-backdrop"><form className="bank-question-editor" onSubmit={saveQuestion}>
      <div className="course-dialog-head"><div><p className="eyebrow">{editingId ? "EDIT QUESTION" : "NEW QUESTION"}</p><h2>{editingId ? "Update reusable MCQ" : "Add reusable MCQ"}</h2></div><button type="button" onClick={() => setEditorOpen(false)}><X /></button></div>
      <label><span>Question prompt</span><textarea required value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Enter a clear single-choice question" /></label>
      <div className="bank-meta-fields"><label><span>Topic</span><input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="e.g. Indian Polity" /></label><label><span>Difficulty</span><select value={difficulty} onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label></div>
      <div className="bank-option-editor"><span>Answer options · select the correct answer</span>{options.map((option, index) => <label key={index}><input type="radio" name="bank-correct" checked={correct === index} onChange={() => setCorrect(index)} /><i>{String.fromCharCode(65 + index)}</i><input required={index < 2} value={option} onChange={(event) => setOptions((current) => current.map((value, optionIndex) => optionIndex === index ? event.target.value : value))} placeholder={`Option ${String.fromCharCode(65 + index)}`} />{options.length > 2 && <button type="button" onClick={() => { setOptions((current) => current.filter((_, optionIndex) => optionIndex !== index)); setCorrect((current) => current === index ? 0 : current > index ? current - 1 : current); }}><X /></button>}</label>)}{options.length < 6 && <button type="button" onClick={() => setOptions((current) => [...current, ""])}><Plus /> Add option</button>}</div>
      <label><span>Explanation (optional)</span><textarea value={explanation} onChange={(event) => setExplanation(event.target.value)} placeholder="Explain why the selected answer is correct" /></label>
      {error && <div className="course-error">{error}</div>}
      <div className="course-dialog-actions"><button type="button" onClick={() => setEditorOpen(false)}>Cancel</button><button className="primary" disabled={saving}>{saving ? <LoaderCircle className="spin" /> : <Check />} {editingId ? "Save changes" : "Add question"}</button></div>
    </form></div>}

    {assignQuestion && <div className="course-dialog-backdrop"><form className="assign-question-dialog" onSubmit={assign}>
      <div className="course-dialog-head"><div><p className="eyebrow">ASSIGN TO QUIZ</p><h2>Reuse question</h2></div><button type="button" onClick={() => setAssignQuestion(null)}><X /></button></div>
      <div className="assign-question-preview"><ClipboardCheck /><p>{assignQuestion.prompt}</p></div>
      <label><span>Target quiz</span><select required value={assessmentId} onChange={(event) => setAssessmentId(event.target.value)}><option value="">Choose a quiz</option>{bank?.assessments.map((assessment) => <option key={assessment.id} value={assessment.id}>{assessment.course_title} · {assessment.title} ({assessment.question_count} questions)</option>)}</select></label>
      {error && <div className="course-error">{error}</div>}
      <div className="course-dialog-actions"><button type="button" onClick={() => setAssignQuestion(null)}>Cancel</button><button className="primary" disabled={saving || !assessmentId}><Plus /> Assign question</button></div>
    </form></div>}
  </div>;
}
