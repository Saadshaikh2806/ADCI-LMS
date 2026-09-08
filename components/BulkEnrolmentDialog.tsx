"use client";

import { BookOpen, Check, LoaderCircle, Radio, Search, ShieldAlert, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  assignCoursesToAdciLearnerGroup,
  bulkSetAdciCourseEnrolment,
  listAdciGrantableCourses,
  type AdciCourseEnrolment,
  type AdciGrantableCourse
} from "../lib/supabase/admin";

type Status = NonNullable<AdciCourseEnrolment["enrolment_status"]>;
const STATUSES: Array<[Status, string]> = [
  ["active", "Active"],
  ["pending", "Pending"],
  ["frozen", "Frozen"],
  ["completed", "Completed"],
  ["cancelled", "Cancelled"]
];

export type BulkEnrolmentTarget =
  | { kind: "group"; groupId: string; groupName: string; memberCount: number }
  | { kind: "people"; learnerIds: string[] };

export default function BulkEnrolmentDialog({ target, canGrant, close, notify, onDone }: {
  target: BulkEnrolmentTarget;
  canGrant: boolean;
  close: () => void;
  notify: (message: string) => void;
  onDone?: () => void;
}) {
  const [courses, setCourses] = useState<AdciGrantableCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "course" | "live">("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<Status>("active");
  const [expiry, setExpiry] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    listAdciGrantableCourses()
      .then((rows) => { if (active) setCourses(rows); })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load courses"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return courses.filter((course) =>
      (kindFilter === "all" || course.kind === kindFilter) &&
      (!needle || course.title.toLowerCase().includes(needle))
    );
  }, [courses, query, kindFilter]);

  const learnerCount = target.kind === "group" ? target.memberCount : target.learnerIds.length;

  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function apply() {
    if (!canGrant || picked.size === 0 || saving) return;
    setSaving(true);
    setError("");
    try {
      const courseIds = [...picked];
      const expiresAt = expiry ? new Date(`${expiry}T23:59:59`).toISOString() : null;
      const result = target.kind === "group"
        ? await assignCoursesToAdciLearnerGroup(target.groupId, courseIds, status, expiresAt)
        : await bulkSetAdciCourseEnrolment(target.learnerIds, courseIds, status, expiresAt);
      notify(`${result.applied} enrolment${result.applied === 1 ? "" : "s"} set · ${result.courses} course${result.courses === 1 ? "" : "s"} · ${result.learners} learner${result.learners === 1 ? "" : "s"}`);
      onDone?.();
      close();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to apply access");
    } finally {
      setSaving(false);
    }
  }

  return <div className="course-dialog-backdrop"><div className="enrolment-dialog bulk-enrolment-dialog">
    <div className="course-dialog-head">
      <div>
        <p className="eyebrow">BULK COURSE ACCESS</p>
        <h2>{target.kind === "group" ? target.groupName : `${learnerCount} selected ${learnerCount === 1 ? "person" : "people"}`}</h2>
      </div>
      <button onClick={close}><X /></button>
    </div>
    <p className="enrolment-intro">
      Grant the chosen courses and live lectures to {target.kind === "group" ? `every current member of this group (${learnerCount})` : `the ${learnerCount} selected ${learnerCount === 1 ? "person" : "people"}`}.
      This is a one-time action; changing membership later does not change access.
    </p>

    {!canGrant && <div className="course-error"><ShieldAlert size={15} /> Only a super administrator can grant course access.</div>}

    <div className="bulk-enrolment-controls">
      <label className="bulk-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search courses" /></label>
      <div className="bulk-kind-filter">
        {(["all", "course", "live"] as const).map((value) => (
          <button key={value} className={kindFilter === value ? "active" : ""} onClick={() => setKindFilter(value)}>
            {value === "all" ? "All" : value === "course" ? "Courses" : "Live"}
          </button>
        ))}
      </div>
    </div>

    {loading ? <div className="cms-loading"><LoaderCircle className="spin" /> Loading courses…</div> : (
      <div className="bulk-course-list">
        {visible.map((course) => (
          <label key={course.course_id} className={picked.has(course.course_id) ? "picked" : ""}>
            <input type="checkbox" checked={picked.has(course.course_id)} onChange={() => toggle(course.course_id)} />
            <span className="bulk-course-icon">{course.kind === "live" ? <Radio size={16} /> : <BookOpen size={16} />}</span>
            <span className="bulk-course-title">
              <strong>{course.title}</strong>
              <small>{course.kind === "live" ? "Live lecture" : "Course"}{course.starts_at ? ` · ${new Date(course.starts_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}` : ""}{course.status !== "published" ? ` · ${course.status}` : ""}</small>
            </span>
          </label>
        ))}
        {visible.length === 0 && <div className="cms-empty"><BookOpen /><h3>No matching courses</h3></div>}
      </div>
    )}

    <div className="bulk-enrolment-apply">
      <label><span>Access status</span>
        <select value={status} onChange={(event) => setStatus(event.target.value as Status)}>
          {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label><span>Access expires (optional)</span>
        <input type="date" value={expiry} onChange={(event) => setExpiry(event.target.value)} />
      </label>
      <button className="primary" disabled={!canGrant || picked.size === 0 || saving} onClick={() => void apply()}>
        {saving ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}
        {saving ? "Applying" : `Apply to ${picked.size || "0"} course${picked.size === 1 ? "" : "s"}`}
      </button>
    </div>

    {error && <div className="course-error">{error}</div>}
  </div></div>;
}
