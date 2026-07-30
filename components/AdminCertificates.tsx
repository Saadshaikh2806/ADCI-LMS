"use client";

import {
  Award,
  BookOpen,
  Check,
  ClipboardCheck,
  Eye,
  GraduationCap,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UsersRound,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import CertificateDocument from "./CertificateDocument";
import {
  getCertificateAdminData,
  issueCertificate,
  revokeCertificate,
  type AdciCertificate,
  type CertificateAdminData,
  type CertificateCandidate
} from "../lib/supabase/certificates";

export default function AdminCertificates({ notify }: { notify: (message: string) => void }) {
  const [data, setData] = useState<CertificateAdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [preview, setPreview] = useState<AdciCertificate | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<CertificateCandidate | null>(null);
  const [revokeReason, setRevokeReason] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setData(await getCertificateAdminData());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load completion records");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const learners = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.learners ?? []).filter((learner) => {
      const state = learner.certificate?.status === "valid"
        ? "issued"
        : learner.certificate?.status === "revoked"
          ? "revoked"
          : learner.eligible ? "eligible" : "in_progress";
      return (!query || learner.learner_name.toLowerCase().includes(query)
          || learner.learner_email.toLowerCase().includes(query)
          || learner.course_title.toLowerCase().includes(query))
        && (courseFilter === "all" || learner.course_id === courseFilter)
        && (statusFilter === "all" || statusFilter === state);
    });
  }, [data, search, courseFilter, statusFilter]);

  async function issue(learner: CertificateCandidate) {
    const action = learner.certificate?.status === "revoked" ? "Reissue" : "Issue";
    if (!window.confirm(`${action} a certificate to ${learner.learner_name} for ${learner.course_title}?`)) return;
    setSaving(true);
    setError("");
    try {
      await issueCertificate(learner.learner_id, learner.course_id);
      notify(`Certificate ${action === "Reissue" ? "reissued" : "issued"}`);
      await refresh();
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : "Unable to issue certificate");
    } finally {
      setSaving(false);
    }
  }

  async function revoke(event: React.FormEvent) {
    event.preventDefault();
    if (!revokeTarget?.certificate) return;
    setSaving(true);
    setError("");
    try {
      await revokeCertificate(revokeTarget.certificate.id, revokeReason);
      notify("Certificate revoked");
      setRevokeTarget(null);
      setRevokeReason("");
      await refresh();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "Unable to revoke certificate");
    } finally {
      setSaving(false);
    }
  }

  function previewCertificate(learner: CertificateCandidate) {
    if (!learner.certificate) return;
    setPreview({
      id: learner.certificate.id,
      certificate_number: learner.certificate.certificate_number,
      verification_code: learner.certificate.verification_code,
      learner_name: learner.learner_name,
      course_title: learner.course_title,
      completion_percent: 100,
      issued_at: learner.certificate.issued_at,
      status: learner.certificate.status,
      revoked_at: learner.certificate.revoked_at,
      revocation_reason: learner.certificate.revocation_reason
    });
  }

  if (loading && !data) return <div className="admin-report-state"><LoaderCircle className="spin" /><span>Calculating course completion…</span></div>;
  if (error && !data) return <div className="admin-report-state error"><Award /><h2>Certificates unavailable</h2><p>{error}</p><button onClick={() => void refresh()}><RefreshCw /> Retry</button></div>;

  return <div className="admin-content admin-certificates-workspace">
    <div className="admin-welcome certificate-admin-heading"><div><h2>Certificates & completion</h2><p>Review course requirements and issue verifiable learner credentials.</p></div><button onClick={() => void refresh()}><RefreshCw className={loading ? "spin" : ""} /> Recalculate</button></div>
    {error && !revokeTarget && <div className="course-error">{error}</div>}
    <section className="certificate-admin-metrics">
      <article><div><Award /></div><span>VALID CERTIFICATES</span><strong>{data?.summary.issued ?? 0}</strong></article>
      <article><div className="eligible"><Check /></div><span>READY TO ISSUE</span><strong>{data?.summary.eligible ?? 0}</strong></article>
      <article><div className="courses"><BookOpen /></div><span>PUBLISHED COURSES</span><strong>{data?.summary.courses ?? 0}</strong></article>
      <article><div className="revoked"><ShieldAlert /></div><span>REVOKED</span><strong>{data?.summary.revoked ?? 0}</strong></article>
    </section>
    <section className="certificate-admin-card">
      <div className="certificate-admin-filters">
        <div><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search learner, email, or course…" /></div>
        <select value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}><option value="all">All courses</option>{data?.courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All completion states</option><option value="eligible">Ready to issue</option><option value="issued">Certificate issued</option><option value="in_progress">In progress</option><option value="revoked">Revoked</option></select>
      </div>
      <div className="certificate-admin-table">
        <div className="certificate-table-head"><span>Learner</span><span>Course</span><span>Requirements</span><span>Completion</span><span>Certificate</span><span>Actions</span></div>
        {learners.map((learner) => {
          const state = learner.certificate?.status === "valid" ? "issued" : learner.certificate?.status === "revoked" ? "revoked" : learner.eligible ? "eligible" : "in-progress";
          return <article key={`${learner.learner_id}-${learner.course_id}`}>
            <div className="certificate-learner"><span>{learner.learner_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span><div><strong>{learner.learner_name}</strong><small>{learner.learner_email}</small></div></div>
            <div><strong>{learner.course_title}</strong><small>{learner.enrolment_status} enrolment</small></div>
            <div className="certificate-requirements"><span title="Lessons"><BookOpen />{learner.lesson_completed}/{learner.lesson_total}</span><span title="Quizzes"><ClipboardCheck />{learner.quiz_passed}/{learner.quiz_total}</span><span title="Assignments"><GraduationCap />{learner.assignment_graded}/{learner.assignment_total}</span></div>
            <div className="certificate-completion"><div><i style={{ width: `${learner.completion_percent}%` }} /></div><strong>{learner.completion_percent}%</strong></div>
            <div><em className={state}>{state.replace("-", " ")}</em>{learner.certificate && <small>{learner.certificate.certificate_number}</small>}</div>
            <div className="certificate-row-actions">
              {learner.certificate?.status === "valid" ? <><button onClick={() => previewCertificate(learner)} title="Preview"><Eye /></button><button className="revoke" onClick={() => { setRevokeTarget(learner); setRevokeReason(""); }} title="Revoke"><ShieldAlert /></button></>
              : learner.eligible ? <button className="issue" disabled={saving} onClick={() => void issue(learner)}><Award /> {learner.certificate ? "Reissue" : "Issue"}</button>
              : <button disabled><RotateCcw /> Incomplete</button>}
            </div>
          </article>;
        })}
        {learners.length === 0 && <div className="report-empty"><UsersRound /> No learner completion records match these filters.</div>}
      </div>
    </section>

    {revokeTarget && <div className="course-dialog-backdrop"><form className="certificate-revoke-dialog" onSubmit={revoke}>
      <header><div><p className="eyebrow">REVOKE CERTIFICATE</p><h2>Invalidate this credential?</h2></div><button type="button" onClick={() => setRevokeTarget(null)}><X /></button></header>
      <div className="certificate-revoke-warning"><ShieldAlert /><p>The public verification result will immediately show this certificate as revoked. The record remains in the audit log.</p></div>
      <dl><div><dt>Learner</dt><dd>{revokeTarget.learner_name}</dd></div><div><dt>Course</dt><dd>{revokeTarget.course_title}</dd></div><div><dt>Certificate</dt><dd>{revokeTarget.certificate?.certificate_number}</dd></div></dl>
      <label><span>Reason for revocation</span><textarea required maxLength={1000} value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} placeholder="Explain why this credential must be revoked…" /></label>
      {error && <div className="course-error">{error}</div>}
      <footer><button type="button" onClick={() => setRevokeTarget(null)}>Cancel</button><button className="danger" disabled={saving}>{saving ? <LoaderCircle className="spin" /> : <ShieldAlert />} Revoke certificate</button></footer>
    </form></div>}
    {preview && <CertificateDocument certificate={preview} close={() => setPreview(null)} />}
  </div>;
}
