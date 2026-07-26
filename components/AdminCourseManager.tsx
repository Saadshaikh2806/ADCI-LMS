"use client";

import { ArrowRight, BookOpen, Check, FileVideo, LoaderCircle, Plus, ShieldCheck, UploadCloud, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  createCourseBundle,
  listAdciCourses,
  type AdciCourse,
  uploadProtectedLessonVideo
} from "../lib/supabase/admin";

export default function AdminCourseManager({ notify }: { notify: (message: string) => void }) {
  const [courses, setCourses] = useState<AdciCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");
  const [courseTitle, setCourseTitle] = useState("");
  const [description, setDescription] = useState("");
  const [moduleTitle, setModuleTitle] = useState("Module 01");
  const [lessonTitle, setLessonTitle] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("30");
  const [video, setVideo] = useState<File | null>(null);

  const slug = useMemo(
    () => courseTitle.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    [courseTitle]
  );

  async function refresh() {
    setLoading(true);
    try {
      setCourses(await listAdciCourses());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load courses");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setUploadProgress(0);

    try {
      const bundle = await createCourseBundle({
        courseTitle,
        slug,
        description,
        moduleTitle,
        lessonTitle,
        lessonType: video ? "video" : "html",
        durationSeconds: Math.max(0, Number(durationMinutes) * 60)
      });

      if (video) {
        await uploadProtectedLessonVideo(bundle.lesson_id, video, setUploadProgress);
      }

      notify(video ? "Course and protected video created" : "Course draft created");
      setDialogOpen(false);
      setCourseTitle("");
      setDescription("");
      setModuleTitle("Module 01");
      setLessonTitle("");
      setVideo(null);
      await refresh();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create course");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-content">
      <div className="admin-welcome">
        <div><h2>Academic content</h2><p>Real courses, modules and protected lessons from Supabase.</p></div>
        <button className="primary" onClick={() => setDialogOpen(true)}><Plus size={17} /> New course</button>
      </div>

      <div className="cms-toolbar">
        <div className="course-data-status"><ShieldCheck size={17} /><span><strong>Live database</strong><small>{courses.length} course{courses.length === 1 ? "" : "s"} available</small></span></div>
        <button onClick={() => void refresh()}>Refresh <ArrowRight size={15} /></button>
      </div>

      <section className="cms-list live-cms-list">
        {loading ? (
          <div className="cms-loading"><LoaderCircle className="spin" /><span>Loading ADCI courses…</span></div>
        ) : courses.length === 0 ? (
          <div className="cms-empty"><div><BookOpen size={26} /></div><h3>Create your first course</h3><p>Add a course, its first module and lesson in one guided step.</p><button className="primary" onClick={() => setDialogOpen(true)}><Plus size={16} /> Create course</button></div>
        ) : courses.map((course) => (
          <article key={course.id}>
            <div className="cms-cover"><BookOpen size={22} /></div>
            <div><h3>{course.title}</h3><p>{course.description || "No description added yet."}</p><span>/{course.slug}</span></div>
            <div className="cms-progress"><span>DATABASE STATUS</span><strong>{course.status === "published" ? "100%" : "25%"}</strong><i><b style={{ width: course.status === "published" ? "100%" : "25%" }} /></i></div>
            <em className={`status-${course.status.replace("_", "-")}`}>{course.status.replace("_", " ")}</em>
            <button className="review-button" onClick={() => notify(`${course.title} editor is ready for the next content sprint`)}>Manage</button>
          </article>
        ))}
      </section>

      <div className="workflow-note"><ShieldCheck size={20} /><div><strong>Protected video workflow</strong><p>Uploads use resumable transfer and are stored in the private adci-course-videos bucket under the lesson ID.</p></div></div>

      {dialogOpen && (
        <div className="course-dialog-backdrop">
          <form className="course-dialog" onSubmit={create}>
            <div className="course-dialog-head"><div><p className="eyebrow">NEW ACADEMIC CONTENT</p><h2>Create course and first lesson</h2></div><button type="button" onClick={() => setDialogOpen(false)}><X /></button></div>
            <div className="course-form-grid">
              <label className="wide"><span>Course title</span><input required value={courseTitle} onChange={(event) => setCourseTitle(event.target.value)} placeholder="e.g. NDA Mathematics Foundation" /><small>URL: /{slug || "course-slug"}</small></label>
              <label className="wide"><span>Description</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What will learners achieve?" /></label>
              <label><span>First module</span><input required value={moduleTitle} onChange={(event) => setModuleTitle(event.target.value)} /></label>
              <label><span>First lesson</span><input required value={lessonTitle} onChange={(event) => setLessonTitle(event.target.value)} placeholder="Lesson title" /></label>
              <label><span>Duration in minutes</span><input required min="0" type="number" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} /></label>
              <label className="video-picker"><span>Recorded lecture (optional)</span><input type="file" accept="video/mp4,video/webm" onChange={(event) => setVideo(event.target.files?.[0] ?? null)} /><div><UploadCloud size={21} /><strong>{video ? video.name : "Choose MP4 or WebM"}</strong><small>{video ? `${(video.size / 1024 / 1024).toFixed(1)} MB` : "Resumable private upload"}</small></div></label>
            </div>
            {saving && video && <div className="upload-progress"><div><FileVideo size={17} /><span>Uploading protected lecture</span><strong>{uploadProgress}%</strong></div><i><b style={{ width: `${uploadProgress}%` }} /></i></div>}
            {error && <div className="course-error">{error}</div>}
            <div className="course-dialog-actions"><button type="button" onClick={() => setDialogOpen(false)}>Cancel</button><button className="primary" disabled={saving}>{saving ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}{saving ? "Creating…" : "Create course"}</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
