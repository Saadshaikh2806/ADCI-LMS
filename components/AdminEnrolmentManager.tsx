"use client";

import { BookOpen, Check, LoaderCircle, Save, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  getAdciUserEnrolments,
  setAdciCourseEnrolment,
  type AdciCourseEnrolment,
  type AdciPerson
} from "../lib/supabase/admin";

export default function AdminEnrolmentManager({ person, close, notify }: {
  person: AdciPerson; close: () => void; notify: (message: string) => void;
}) {
  const [courses, setCourses] = useState<AdciCourseEnrolment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true);
    try { setCourses(await getAdciUserEnrolments(person.user_id)); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Unable to load courses"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, [person.user_id]);

  async function update(course: AdciCourseEnrolment, status: NonNullable<AdciCourseEnrolment["enrolment_status"]>, expiry: string) {
    setSaving(course.course_id); setError("");
    try {
      await setAdciCourseEnrolment(person.user_id, course.course_id, status, expiry ? new Date(`${expiry}T23:59:59`).toISOString() : null);
      await refresh(); notify(`${person.full_name || person.email} enrolment updated`);
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Unable to update enrolment"); }
    finally { setSaving(""); }
  }

  return <div className="course-dialog-backdrop"><div className="enrolment-dialog">
    <div className="course-dialog-head"><div><p className="eyebrow">COURSE ACCESS</p><h2>{person.full_name || person.email}</h2></div><button onClick={close}><X /></button></div>
    <p className="enrolment-intro">Assign courses, control access status, and optionally set an expiry date.</p>
    {loading ? <div className="cms-loading"><LoaderCircle className="spin" /> Loading courses…</div> : <div className="enrolment-list">
      {courses.map((course) => <EnrolmentRow key={course.course_id} course={course} saving={saving === course.course_id} update={update} />)}
      {courses.length === 0 && <div className="cms-empty"><BookOpen /><h3>No courses available</h3><p>Publish or create an academic course first.</p></div>}
    </div>}
    {error && <div className="course-error">{error}</div>}
  </div></div>;
}

function EnrolmentRow({ course, saving, update }: {
  course: AdciCourseEnrolment; saving: boolean;
  update: (course: AdciCourseEnrolment, status: NonNullable<AdciCourseEnrolment["enrolment_status"]>, expiry: string) => void;
}) {
  const [status, setStatus] = useState<NonNullable<AdciCourseEnrolment["enrolment_status"]>>(course.enrolment_status ?? "pending");
  const [expiry, setExpiry] = useState(course.access_expires_at?.slice(0, 10) ?? "");
  return <article><div className="enrolment-course-icon"><BookOpen size={19} /></div><div><strong>{course.title}</strong><small>Course: {course.status}{course.enrolment_status ? ` · Current access: ${course.enrolment_status}` : " · Not enrolled"}</small></div><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="pending">Pending</option><option value="active">Active</option><option value="frozen">Frozen</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select><input type="date" value={expiry} onChange={(event) => setExpiry(event.target.value)} aria-label="Access expiry" /><button disabled={saving} onClick={() => update(course, status, expiry)}>{saving ? <LoaderCircle size={15} className="spin" /> : course.enrolment_status === status && (course.access_expires_at?.slice(0, 10) ?? "") === expiry ? <Check size={15} /> : <Save size={15} />}{saving ? "Saving" : "Apply"}</button></article>;
}
