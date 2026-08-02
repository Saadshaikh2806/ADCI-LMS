"use client";

import {
  CalendarClock,
  Check,
  ClipboardList,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  FileUp,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getMyAssignmentFileUrl,
  getMyAssignments,
  saveMyAssignmentSubmission,
  uploadAssignmentFile,
  type LearnerAssignment
} from "../lib/supabase/learning";

function formatBytes(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDeadline(value: string | null) {
  if (!value) return "No deadline";
  return new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function deadlineNote(value: string | null) {
  if (!value) return "Open deadline";
  const milliseconds = new Date(value).getTime() - Date.now();
  if (milliseconds < 0) return "Deadline passed";
  const days = Math.floor(milliseconds / 86400000);
  if (days > 0) return `${days} day${days === 1 ? "" : "s"} remaining`;
  const hours = Math.max(1, Math.ceil(milliseconds / 3600000));
  return `${hours} hour${hours === 1 ? "" : "s"} remaining`;
}

export default function StudentAssignments({
  close,
  notify,
  initialAssignmentId
}: {
  close: () => void;
  notify: (message: string) => void;
  initialAssignmentId?: string;
}) {
  const [assignments, setAssignments] = useState<LearnerAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("active");
  const [selected, setSelected] = useState<LearnerAssignment | null>(null);
  const [textResponse, setTextResponse] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setAssignments(await getMyAssignments());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load assignments");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    if (!initialAssignmentId || assignments.length === 0) return;
    const target = assignments.find((assignment) => assignment.id === initialAssignmentId);
    if (target) openAssignment(target);
  }, [initialAssignmentId, assignments]);

  const visibleAssignments = useMemo(() => assignments.filter((assignment) => {
    if (filter === "active") return ["pending", "returned"].includes(assignment.state);
    if (filter === "submitted") return assignment.state === "submitted";
    if (filter === "graded") return assignment.state === "graded";
    if (filter === "overdue") return assignment.state === "overdue";
    return true;
  }), [assignments, filter]);

  const counts = useMemo(() => ({
    active: assignments.filter((assignment) => ["pending", "returned"].includes(assignment.state)).length,
    submitted: assignments.filter((assignment) => assignment.state === "submitted").length,
    graded: assignments.filter((assignment) => assignment.state === "graded").length,
    overdue: assignments.filter((assignment) => assignment.state === "overdue").length
  }), [assignments]);

  function openAssignment(assignment: LearnerAssignment) {
    setSelected(assignment);
    setTextResponse(assignment.submission?.text_response ?? "");
    setLinkUrl(assignment.submission?.link_url ?? "");
    setSelectedFile(null);
    setError("");
  }

  async function persist(submitNow: boolean) {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      let filePath = selected.submission?.file_path ?? "";
      let fileName = selected.submission?.file_name ?? "";
      let fileMimeType = selected.submission?.file_mime_type ?? "";
      let fileSizeBytes = selected.submission?.file_size_bytes ?? null;
      if (selectedFile) {
        if (!selected.allowed_mime_types.includes(selectedFile.type)) {
          throw new Error("This file format is not allowed for the assignment");
        }
        if (selectedFile.size > selected.max_file_bytes) {
          throw new Error(`The file must be smaller than ${formatBytes(selected.max_file_bytes)}`);
        }
        const uploaded = await uploadAssignmentFile(selected.id, selectedFile);
        filePath = uploaded.path;
        fileName = uploaded.name;
        fileMimeType = uploaded.mimeType;
        fileSizeBytes = uploaded.sizeBytes;
      }
      await saveMyAssignmentSubmission({
        assignmentId: selected.id,
        text: textResponse,
        link: linkUrl,
        filePath,
        fileName,
        fileMimeType,
        fileSizeBytes,
        submitNow
      });
      notify(submitNow ? "Assignment submitted successfully" : "Assignment draft saved");
      setSelected(null);
      await refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save submission");
    } finally {
      setSaving(false);
    }
  }

  async function openFile(path: string) {
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    try {
      const url = await getMyAssignmentFileUrl(path);
      if (popup) popup.location.href = url;
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch (fileError) {
      if (popup) popup.close();
      setError(fileError instanceof Error ? fileError.message : "Unable to open submission file");
    }
  }

  const canEdit = selected ? ["pending", "returned"].includes(selected.state) : false;
  const acceptsFile = selected ? ["file", "mixed"].includes(selected.submission_type) : false;
  const acceptsText = selected ? ["text", "mixed"].includes(selected.submission_type) : false;
  const acceptsLink = selected ? ["link", "mixed"].includes(selected.submission_type) : false;

  return <div className="learner-assignments-page">
    <header className="learner-assignments-header">
      <span aria-hidden="true" />
      <div><p className="eyebrow">ADCI COURSEWORK</p><h1>Assignments</h1></div>
      <button className="assignment-refresh" onClick={() => void refresh()}><RefreshCw className={loading ? "spin" : ""} /> Refresh</button>
    </header>

    <main className="learner-assignments-content">
      <section className="learner-assignment-summary">
        <article><div><ClipboardList /></div><span>TO COMPLETE</span><strong>{counts.active}</strong></article>
        <article><div className="submitted"><Send /></div><span>AWAITING REVIEW</span><strong>{counts.submitted}</strong></article>
        <article><div className="graded"><ShieldCheck /></div><span>GRADED</span><strong>{counts.graded}</strong></article>
        <article><div className="overdue"><Clock3 /></div><span>OVERDUE</span><strong>{counts.overdue}</strong></article>
      </section>

      <section className="learner-assignment-card">
        <div className="learner-assignment-tabs">
          {(["active", "submitted", "graded", "overdue", "all"] as const).map((item) =>
            <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>
              {item === "active" ? "To complete" : item[0].toUpperCase() + item.slice(1)}
              {item !== "all" && <span>{counts[item]}</span>}
            </button>
          )}
        </div>
        {error && !selected && <div className="assignment-error">{error}<button onClick={() => void refresh()}>Retry</button></div>}
        <div className="learner-assignment-list">
          {loading ? <div className="assignment-empty"><LoaderCircle className="spin" /> Loading coursework…</div>
          : visibleAssignments.length === 0 ? <div className="assignment-empty"><Check /><h3>Nothing here right now</h3><p>Your assignments will appear under the relevant status.</p></div>
          : visibleAssignments.map((assignment) => <article key={assignment.id} className={`state-${assignment.state}`}>
            <div className="learner-assignment-icon">{assignment.state === "returned" ? <RotateCcw /> : assignment.state === "graded" ? <Check /> : <FileText />}</div>
            <div className="learner-assignment-copy">
              <div><span>{assignment.course_title}</span><em>{assignment.submission_type}</em></div>
              <h2>{assignment.title}</h2>
              <p>{assignment.instructions || "Open the assignment to review requirements and submit your work."}</p>
              <footer><span><CalendarClock /> Due {formatDeadline(assignment.due_at)}</span><strong>{deadlineNote(assignment.due_at)}</strong></footer>
            </div>
            <div className="learner-assignment-result">
              <span className={`assignment-state ${assignment.state}`}>{assignment.state}</span>
              {assignment.state === "graded" && <strong>{assignment.submission?.score}/{assignment.max_score}</strong>}
              <button onClick={() => openAssignment(assignment)}>{["submitted", "graded", "overdue"].includes(assignment.state) ? "View details" : assignment.state === "returned" ? "Revise work" : "Open assignment"}</button>
            </div>
          </article>)}
        </div>
      </section>
    </main>

    {selected && <div className="assignment-dialog-backdrop">
      <section className="student-assignment-dialog">
        <header><div><p className="eyebrow">{selected.course_title}</p><h2>{selected.title}</h2></div><button onClick={() => setSelected(null)}><X /></button></header>
        <div className="assignment-detail-meta"><span><CalendarClock /> Due {formatDeadline(selected.due_at)}</span><span><ShieldCheck /> {selected.max_score} marks</span><span><FileText /> {selected.submission_type} response</span></div>
        <div className="assignment-instructions"><h3>Instructions</h3><p>{selected.instructions || "Complete the work and submit it before the deadline."}</p></div>

        {selected.state === "returned" && <div className="returned-feedback"><RotateCcw /><div><strong>Returned for revision</strong><p>{selected.submission?.feedback || "Please update your work and submit it again."}</p></div></div>}
        {selected.state === "graded" && <div className="graded-feedback"><Check /><div><span>FINAL SCORE</span><strong>{selected.submission?.score} / {selected.max_score}</strong><p>{selected.submission?.feedback || "Your assignment has been graded."}</p></div></div>}

        <div className="assignment-response-form">
          {acceptsText && <label><span>Written response</span><textarea disabled={!canEdit} maxLength={20000} value={textResponse} onChange={(event) => setTextResponse(event.target.value)} placeholder="Write your answer here…" /><small>{textResponse.length}/20000</small></label>}
          {acceptsLink && <label><span>Submission link</span><input disabled={!canEdit} type="url" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://…" /></label>}
          {acceptsFile && <label className="assignment-file-picker"><span>Attachment</span><input ref={fileInput} disabled={!canEdit} type="file" accept={selected.allowed_mime_types.join(",")} onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} /><button type="button" disabled={!canEdit} onClick={() => fileInput.current?.click()}><FileUp /><span><strong>{selectedFile?.name || selected.submission?.file_name || "Choose a file"}</strong><small>{selectedFile ? formatBytes(selectedFile.size) : selected.submission?.file_size_bytes ? `${formatBytes(selected.submission.file_size_bytes)} uploaded` : `PDF, Word, JPG or PNG · Max ${formatBytes(selected.max_file_bytes)}`}</small></span></button></label>}
          {selected.submission?.file_path && !selectedFile && <button className="view-submitted-file" onClick={() => void openFile(selected.submission!.file_path!)}><Download /> Open submitted file <ExternalLink /></button>}
        </div>
        {selected.state === "submitted" && <div className="submission-locked"><ShieldCheck /> Submitted {selected.submission?.submitted_at ? new Date(selected.submission.submitted_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : ""}. Editing is locked while your teacher reviews it.</div>}
        {selected.state === "overdue" && <div className="submission-locked overdue"><Clock3 /> The deadline has passed and new submissions are closed.</div>}
        {error && <div className="assignment-error">{error}</div>}
        <footer className="assignment-dialog-actions">
          <button onClick={() => setSelected(null)}>Close</button>
          {canEdit && <><button disabled={saving} onClick={() => void persist(false)}>{saving ? <LoaderCircle className="spin" /> : <FileText />} Save draft</button><button className="primary" disabled={saving} onClick={() => void persist(true)}>{saving ? <LoaderCircle className="spin" /> : <Send />} Submit assignment</button></>}
        </footer>
      </section>
    </div>}
  </div>;
}
