"use client";

import { ArrowRight, BookOpen, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "../lib/supabase/client";
import StudentCoursePlayer from "./StudentCoursePlayer";

type LearnerCourse = {
  id: string;
  title: string;
  slug: string;
  description: string;
  status: string;
  access_expires_at: string | null;
  lesson_count: number;
  completed_count: number;
};

export default function StudentCourses({
  close,
  notify
}: {
  close: () => void;
  notify: (message: string) => void;
}) {
  const [courses, setCourses] = useState<LearnerCourse[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
    };
  }, []);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase.rpc("adci_get_my_courses").then(({ data, error: loadError }) => {
      if (loadError) setError(loadError.message);
      else setCourses((data ?? []) as LearnerCourse[]);
      setLoading(false);
    });
  }, []);

  if (selectedCourseId) {
    return <StudentCoursePlayer courseId={selectedCourseId} close={() => setSelectedCourseId("")} notify={notify} />;
  }

  return <section className="student-courses-page">
    <header className="student-courses-header">
      <span aria-hidden="true" />
      <div><p className="eyebrow">MY LEARNING</p><h1>My courses</h1><p>Active enrolments and learning progress.</p></div>
      <span aria-hidden="true" />
    </header>
    <div className="student-courses-content">
    {loading ? <div className="cms-loading"><LoaderCircle className="spin" /> Loading your courses…</div>
      : error ? <div className="course-error">{error}</div>
      : courses.length === 0 ? <div className="cms-empty"><div><BookOpen /></div><h3>No active courses</h3><p>Your administrator must enrol you in a published course.</p></div>
      : <div className="student-course-grid">{courses.map((course) => {
        const progress = course.lesson_count ? Math.round(course.completed_count / course.lesson_count * 100) : 0;
        return <article key={course.id}>
          <div className="student-course-cover"><BookOpen /></div>
          <div className="student-course-copy">
            <span>/{course.slug}</span>
            <h3>{course.title}</h3>
            <p>{course.description || "Course curriculum ready for learning."}</p>
            <div><i><b style={{ width: `${progress}%` }} /></i><strong>{progress}%</strong></div>
            <small>{course.completed_count} of {course.lesson_count} lessons complete{course.access_expires_at ? ` · Access until ${new Date(course.access_expires_at).toLocaleDateString("en-IN")}` : ""}</small>
          </div>
          <button onClick={() => setSelectedCourseId(course.id)}>Open course <ArrowRight size={15} /></button>
        </article>;
      })}</div>}
    </div>
  </section>;
}
