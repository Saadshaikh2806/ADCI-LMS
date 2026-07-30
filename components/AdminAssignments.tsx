"use client";

import {
  Archive,
  CalendarClock,
  Check,
  ClipboardList,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  GraduationCap,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  UsersRound,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  archiveAdciAssignment,
  getAdciAssignments,
  getAdciAssignmentSubmissions,
  getAdciSubmissionFileUrl,
  gradeAdciAssignmentSubmission,
  saveAdciAssignment,
  type AdciAssignment,
  type AdciAssignmentAdminData,
  type AdciAssignmentSubmission,
  type AdciAssignmentSubmissionsData
} from "../lib/supabase/admin";

function localDateTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function formatDate(value: string | null) {
  if (!value) return "No deadline";
  return new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export default function AdminAssignments({ notify }: { notify: (message: string) => void }) {
  const [data, setData] = useState<AdciAssignmentAdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [submissionType, setSubmissionType] = useState<AdciAssignment["submission_type"]>("mixed");
  const [maxScore, setMaxScore] = useState("100");
  const [availableFrom, setAvailableFrom] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [status, setStatus] = useState<AdciAssignment["status"]>("draft");
  const [gradingData, setGradingData] = useState<AdciAssignmentSubmissionsData | null>(null);
  const [gradingLoading, setGradingLoading] = useState(false);
  const [submissionFilter, setSubmissionFilter] = useState("all");
  const [selectedSubmission, setSelectedSubmission] = useState<AdciAssignmentSubmission | null>(null);
  const [score, setScore] = useState("");
  const [feedback, setFeedback] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const result = await getAdciAssignments();
      setData(result);
      if (!courseId && result.courses[0]) setCourseId(result.courses[0].id);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load assignments");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const assignments = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.assignments ?? []).filter((assignment) =>
      (!query || assignment.title.toLowerCase().includes(query) || assignment.course_title.toLowerCase().includes(query))
      && (courseFilter === "all" || assignment.course_id === courseFilter)
      && (statusFilter === "all"
        || (statusFilter === "active" && assignment.status !== "retired")
        || assignment.status === statusFilter)
    );
  }, [data, search, courseFilter, statusFilter]);

  const submissions = useMemo(() => (gradingData?.submissions ?? []).filter((submission) =>
    submissionFilter === "all" || submission.status === submissionFilter
  ), [gradingData, submissionFilter]);

  function openEditor(assignment?: AdciAssignment) {
    setEditingId(assignment?.id ?? "");
    setCourseId(assignment?.course_id ?? data?.courses[0]?.id ?? "");
    setTitle(assignment?.title ?? "");
    setInstructions(assignment?.instructions ?? "");
    setSubmissionType(assignment?.submission_type ?? "mixed");
    setMaxScore(String(assignment?.max_score ?? 100));
    setAvailableFrom(localDateTime(assignment?.available_from) || localDateTime(new Date().toISOString()));
    setDueAt(localDateTime(assignment?.due_at));
    setStatus(assignment?.status ?? "draft");
    setEditorOpen(true);
    setError("");
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await saveAdciAssignment({
        id: editingId || undefined,
        courseId,
        title,
        instructions,
        submissionType,
        maxScore: Number(maxScore),
        availableFrom: availableFrom ? new Date(availableFrom).toISOString() : null,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        status
      });
      notify(status === "published" ? "Assignment published" : "Assignment saved");
      setEditorOpen(false);
      await refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save assignment");
    } finally {
      setSaving(false);
    }
  }

  async function archive(assignment: AdciAssignment) {
    if (!window.confirm(`Remove “${assignment.title}”? Assignments with submissions will be archived to preserve grades.`)) return;
    setSaving(true);
    setError("");
    try {
      const result = await archiveAdciAssignment(assignment.id);
      notify(result === "deleted" ? "Assignment deleted" : "Assignment archived");
      await refresh();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Unable to remove assignment");
    } finally {
      setSaving(false);
    }
  }

  async function openSubmissions(assignment: AdciAssignment) {
    setGradingLoading(true);
    setError("");
    setSubmissionFilter("all");
    try {
      setGradingData(await getAdciAssignmentSubmissions(assignment.id));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load submissions");
    } finally {
      setGradingLoading(false);
    }
  }

  function selectForGrading(submission: AdciAssignmentSubmission) {
    setSelectedSubmission(submission);
    setScore(submission.score === null ? "" : String(submission.score));
    setFeedback(submission.feedback ?? "");
    setError("");
  }

  async function grade(decision: "graded" | "returned") {
    if (!selectedSubmission?.submission_id) return;
    setSaving(true);
    setError("");
    try {
      await gradeAdciAssignmentSubmission(
        selectedSubmission.submission_id,
        decision === "graded" ? Number(score) : null,
        feedback,
        decision
      );
      notify(decision === "graded" ? "Submission graded" : "Submission returned for revision");
      const assignmentId = gradingData?.assignment.id;
      setSelectedSubmission(null);
      if (assignmentId) setGradingData(await getAdciAssignmentSubmissions(assignmentId));
      await refresh();
    } catch (gradeError) {
      setError(gradeError instanceof Error ? gradeError.message : "Unable to update grade");
    } finally {
      setSaving(false);
    }
  }

  async function openFile(path: string) {
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    try {
      const url = await getAdciSubmissionFileUrl(path);
      if (popup) popup.location.href = url;
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch (fileError) {
      if (popup) popup.close();
      setError(fileError instanceof Error ? fileError.message : "Unable to open submission file");
    }
  }

  if (loading && !data) return <div className="admin-report-state"><LoaderCircle className="spin" /><span>Loading assignments…</span></div>;
  if (error && !data) return <div className="admin-report-state error"><ClipboardList /><h2>Assignments unavailable</h2><p>{error}</p><button onClick={() => void refresh()}><RefreshCw /> Retry</button></div>;

  return <div className="admin-content admin-assignments-workspace">
    <div className="admin-welcome assignment-admin-heading"><div><h2>Assignments & grading</h2><p>Create coursework, monitor submissions, and provide teacher feedback.</p></div><div><button onClick={() => void refresh()}><RefreshCw className={loading ? "spin" : ""} /> Refresh</button><button className="primary" onClick={() => openEditor()}><Plus /> New assignment</button></div></div>
    {error && !editorOpen && !selectedSubmission && <div className="course-error">{error}</div>}

    <section className="assignment-admin-metrics">
      <article><div><ClipboardList /></div><span>ASSIGNMENTS</span><strong>{data?.summary.total ?? 0}</strong></article>
      <article><div className="published"><Send /></div><span>PUBLISHED</span><strong>{data?.summary.published ?? 0}</strong></article>
      <article><div className="review"><FileCheck2 /></div><span>AWAITING REVIEW</span><strong>{data?.summary.awaiting_review ?? 0}</strong></article>
      <article><div className="graded"><GraduationCap /></div><span>GRADED</span><strong>{data?.summary.graded ?? 0}</strong></article>
    </section>

    <section className="assignment-admin-card">
      <div className="assignment-admin-filters">
        <div className="assignment-search"><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search assignments…" /></div>
        <select value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}><option value="all">All courses</option>{data?.courses.map((course) => <option value={course.id} key={course.id}>{course.title}</option>)}</select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="active">Active assignments</option><option value="all">All statuses</option><option value="published">Published</option><option value="draft">Draft</option><option value="retired">Archived</option></select>
      </div>
      <div className="assignment-admin-list">
        {assignments.map((assignment) => {
          const completion = assignment.learner_count ? Math.round(assignment.submission_count / assignment.learner_count * 100) : 0;
          return <article key={assignment.id}>
            <div className="assignment-admin-icon"><FileText /></div>
            <div className="assignment-admin-copy"><div><span>{assignment.course_title}</span><em>{assignment.submission_type}</em><small className={assignment.status}>{assignment.status}</small></div><h3>{assignment.title}</h3><p>{assignment.instructions || "No instructions added."}</p><footer><span><CalendarClock /> {formatDate(assignment.due_at)}</span><span><ShieldCheck /> {assignment.max_score} marks</span></footer></div>
            <div className="assignment-admin-progress"><div><span><i style={{ width: `${completion}%` }} /></span><strong>{completion}%</strong></div><small>{assignment.submission_count}/{assignment.learner_count} submitted</small>{assignment.awaiting_review_count > 0 && <em>{assignment.awaiting_review_count} to review</em>}</div>
            <div className="assignment-admin-actions"><button className="review" onClick={() => void openSubmissions(assignment)}><UsersRound /> Submissions</button><button onClick={() => openEditor(assignment)} title="Edit"><Pencil /></button><button className="delete" disabled={saving} onClick={() => void archive(assignment)} title="Remove"><Archive /></button></div>
          </article>;
        })}
        {assignments.length === 0 && <div className="report-empty"><ClipboardList /> No assignments match these filters.</div>}
      </div>
    </section>

    {editorOpen && <div className="course-dialog-backdrop"><form className="assignment-editor" onSubmit={save}>
      <div className="course-dialog-head"><div><p className="eyebrow">{editingId ? "EDIT ASSIGNMENT" : "NEW ASSIGNMENT"}</p><h2>{editingId ? "Update coursework" : "Create coursework"}</h2></div><button type="button" onClick={() => setEditorOpen(false)}><X /></button></div>
      <div className="assignment-editor-grid">
        <label className="wide"><span>Assignment title</span><input required maxLength={180} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Example: Indian Polity essay" /></label>
        <label><span>Course</span><select required value={courseId} onChange={(event) => setCourseId(event.target.value)}><option value="">Select course</option>{data?.courses.map((course) => <option value={course.id} key={course.id}>{course.title}</option>)}</select></label>
        <label><span>Submission format</span><select value={submissionType} onChange={(event) => setSubmissionType(event.target.value as typeof submissionType)}><option value="mixed">File, text or link</option><option value="file">File only</option><option value="text">Written response</option><option value="link">Link only</option></select></label>
        <label><span>Maximum score</span><input required min="1" step="0.5" type="number" value={maxScore} onChange={(event) => setMaxScore(event.target.value)} /></label>
        <label><span>Publishing status</span><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="draft">Draft</option><option value="published">Published</option><option value="retired">Archived</option></select></label>
        <label><span>Available from</span><input type="datetime-local" value={availableFrom} onChange={(event) => setAvailableFrom(event.target.value)} /></label>
        <label><span>Due date</span><input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
        <label className="wide"><span>Instructions</span><textarea maxLength={10000} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Explain the task, expected format, and evaluation criteria…" /><small>{instructions.length}/10000</small></label>
      </div>
      {error && <div className="course-error">{error}</div>}
      <div className="course-dialog-actions"><button type="button" onClick={() => setEditorOpen(false)}>Cancel</button><button className="primary" disabled={saving}>{saving ? <LoaderCircle className="spin" /> : status === "published" ? <Send /> : <Check />} {status === "published" ? "Publish assignment" : "Save assignment"}</button></div>
    </form></div>}

    {(gradingLoading || gradingData) && <div className="assignment-grading-backdrop">
      <section className="assignment-grading-panel">
        <header><div><p className="eyebrow">SUBMISSION REVIEW</p><h2>{gradingData?.assignment.title ?? "Loading submissions…"}</h2></div><button onClick={() => { setGradingData(null); setGradingLoading(false); }}><X /></button></header>
        {gradingLoading ? <div className="assignment-empty"><LoaderCircle className="spin" /> Loading student submissions…</div>
        : <><div className="grading-toolbar">{(["all", "submitted", "graded", "returned", "not_submitted"] as const).map((item) => <button key={item} className={submissionFilter === item ? "active" : ""} onClick={() => setSubmissionFilter(item)}>{item.replace("_", " ")}</button>)}</div>
        <div className="grading-list">{submissions.map((submission) => <article key={submission.learner_id}>
          <span>{submission.learner_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>
          <div><strong>{submission.learner_name}</strong><small>{submission.learner_email}</small></div>
          <em className={submission.status}>{submission.status.replace("_", " ")}</em>
          <div>{submission.submitted_at ? <><strong>{new Date(submission.submitted_at).toLocaleDateString("en-IN")}</strong><small>Submitted</small></> : <small>No work received</small>}</div>
          <div>{submission.status === "graded" ? <><strong>{submission.score}/{gradingData?.assignment.max_score}</strong><small>Final score</small></> : submission.status === "submitted" ? <strong className="needs-review">Review now</strong> : null}</div>
          <button disabled={!submission.submission_id || submission.status === "draft"} onClick={() => selectForGrading(submission)}>{submission.status === "graded" ? "View grade" : "Open"}</button>
        </article>)}</div></>}
      </section>
    </div>}

    {selectedSubmission && gradingData && <div className="course-dialog-backdrop grading-editor-backdrop"><section className="grading-editor">
      <header><div><p className="eyebrow">TEACHER REVIEW</p><h2>{selectedSubmission.learner_name}</h2><span>{gradingData.assignment.title}</span></div><button onClick={() => setSelectedSubmission(null)}><X /></button></header>
      <div className="grading-submission-content">
        {selectedSubmission.text_response && <section><h3>Written response</h3><p>{selectedSubmission.text_response}</p></section>}
        {selectedSubmission.link_url && <a href={selectedSubmission.link_url} target="_blank" rel="noreferrer"><ExternalLink /> Open submitted link</a>}
        {selectedSubmission.file_path && <button onClick={() => void openFile(selectedSubmission.file_path!)}><Download /><span><strong>{selectedSubmission.file_name}</strong><small>Open protected submission file</small></span><ExternalLink /></button>}
        {!selectedSubmission.text_response && !selectedSubmission.link_url && !selectedSubmission.file_path && <div className="assignment-empty"><FileText /> No submission content.</div>}
      </div>
      <div className="grading-fields"><label><span>Score out of {gradingData.assignment.max_score}</span><input type="number" min="0" max={gradingData.assignment.max_score} step="0.5" value={score} onChange={(event) => setScore(event.target.value)} /></label><label><span>Teacher feedback</span><textarea maxLength={10000} value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Give the learner clear, constructive feedback…" /></label></div>
      {error && <div className="course-error">{error}</div>}
      <footer><button onClick={() => setSelectedSubmission(null)}>Close</button><button disabled={saving} onClick={() => void grade("returned")}><RotateCcw /> Return for revision</button><button className="primary" disabled={saving || score === ""} onClick={() => void grade("graded")}>{saving ? <LoaderCircle className="spin" /> : <GraduationCap />} Save grade</button></footer>
    </section></div>}
  </div>;
}
