"use client";

import { ArrowRight, BookOpen, Check, CirclePlay, FileVideo, Layers3, LoaderCircle, Plus, Save, ShieldCheck, Trash2, UploadCloud, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  createCourseBundle,
  addAdciCourseModule,
  addAdciModuleLesson,
  deleteAdciAcademicEntity,
  getAdciCourseEditor,
  listAdciCourses,
  type AdciCourse,
  type AdciCourseEditor,
  type AdciLesson,
  updateAdciCourse,
  uploadProtectedLessonAsset,
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
  const [editor, setEditor] = useState<AdciCourseEditor | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorTitle, setEditorTitle] = useState("");
  const [editorDescription, setEditorDescription] = useState("");
  const [editorStatus, setEditorStatus] = useState("draft");
  const [newModuleTitle, setNewModuleTitle] = useState("");
  const [lessonModuleId, setLessonModuleId] = useState("");
  const [newLessonTitle, setNewLessonTitle] = useState("");
  const [newLessonType, setNewLessonType] = useState<AdciLesson["lesson_type"]>("video");
  const [newLessonMinutes, setNewLessonMinutes] = useState("30");
  const [newLessonFile, setNewLessonFile] = useState<File | null>(null);
  const [lessonUploadProgress, setLessonUploadProgress] = useState(0);

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

  async function openEditor(course: AdciCourse) {
    setEditorLoading(true);
    setError("");
    try {
      const detail = await getAdciCourseEditor(course.id);
      setEditor(detail);
      setEditorTitle(detail.title);
      setEditorDescription(detail.description);
      setEditorStatus(detail.status);
      setLessonModuleId(detail.adci_modules[0]?.id ?? "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to open course");
    } finally {
      setEditorLoading(false);
    }
  }

  async function reloadEditor(courseId: string) {
    const detail = await getAdciCourseEditor(courseId);
    setEditor(detail);
    setLessonModuleId((current) => current || detail.adci_modules[0]?.id || "");
  }

  async function saveCourse(event: React.FormEvent) {
    event.preventDefault();
    if (!editor) return;
    setSaving(true);
    setError("");
    try {
      await updateAdciCourse(editor.id, editorTitle, editorDescription, editorStatus);
      await reloadEditor(editor.id);
      await refresh();
      notify("Course details and publishing status saved");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save course");
    } finally {
      setSaving(false);
    }
  }

  async function addModule(event: React.FormEvent) {
    event.preventDefault();
    if (!editor || !newModuleTitle.trim()) return;
    setSaving(true);
    setError("");
    try {
      await addAdciCourseModule(editor.id, newModuleTitle);
      setNewModuleTitle("");
      await reloadEditor(editor.id);
      notify("Module added");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to add module");
    } finally {
      setSaving(false);
    }
  }

  async function addLesson(event: React.FormEvent) {
    event.preventDefault();
    if (!editor || !lessonModuleId || !newLessonTitle.trim()) return;
    setSaving(true);
    setError("");
    setLessonUploadProgress(0);
    try {
      const lesson = await addAdciModuleLesson(lessonModuleId, newLessonTitle, newLessonType, Math.max(0, Number(newLessonMinutes) * 60));
      if (newLessonFile && (newLessonType === "video" || newLessonType === "audio" || newLessonType === "pdf")) {
        await uploadProtectedLessonAsset(lesson.id, newLessonType, newLessonFile, setLessonUploadProgress);
      }
      setNewLessonTitle("");
      setNewLessonFile(null);
      setLessonUploadProgress(0);
      await reloadEditor(editor.id);
      notify(newLessonFile ? "Lesson and protected file uploaded" : "Lesson added");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to add lesson");
    } finally {
      setSaving(false);
    }
  }

  async function removeEntity(
    kind: "course" | "module" | "lesson",
    id: string,
    label: string,
    lessons: AdciLesson[]
  ) {
    if (!editor || !window.confirm(`Delete ${label}? This cannot be undone.`)) return;
    setSaving(true);
    setError("");
    try {
      await deleteAdciAcademicEntity(kind, id, lessons);
      if (kind === "course") {
        setEditor(null);
        await refresh();
      } else {
        await reloadEditor(editor.id);
      }
      notify(`${kind[0].toUpperCase()}${kind.slice(1)} deleted`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : `Unable to delete ${kind}`);
    } finally {
      setSaving(false);
    }
  }

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
            <button className="review-button" disabled={editorLoading} onClick={() => void openEditor(course)}>{editorLoading ? "Opening…" : "Manage"}</button>
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

      {editor && (
        <div className="course-dialog-backdrop">
          <div className="course-editor">
            <div className="course-dialog-head"><div><p className="eyebrow">COURSE WORKSPACE</p><h2>{editor.title}</h2></div><button type="button" onClick={() => setEditor(null)}><X /></button></div>
            <div className="course-editor-layout">
              <form className="course-settings" onSubmit={saveCourse}>
                <h3>Course settings</h3>
                <label><span>Title</span><input required value={editorTitle} onChange={(event) => setEditorTitle(event.target.value)} /></label>
                <label><span>Description</span><textarea value={editorDescription} onChange={(event) => setEditorDescription(event.target.value)} /></label>
                <label><span>Publishing status</span><select value={editorStatus} onChange={(event) => setEditorStatus(event.target.value)}><option value="draft">Draft</option><option value="in_review">In review</option><option value="approved">Approved</option><option value="published">Published</option><option value="retired">Retired</option></select></label>
                <button className="primary" disabled={saving}><Save size={16} /> Save course</button>
                <button type="button" className="danger-action" disabled={saving || editor.status !== "draft"} onClick={() => void removeEntity("course", editor.id, `"${editor.title}" and all of its curriculum`, editor.adci_modules.flatMap((module) => module.adci_lessons))}><Trash2 size={15} /> Delete draft course</button>
                {editor.status !== "draft" && <small className="delete-guidance">Published or reviewed courses must be retired instead of deleted.</small>}
              </form>
              <section className="curriculum-builder">
                <div className="curriculum-heading"><div><h3>Curriculum</h3><p>{editor.adci_modules.length} module{editor.adci_modules.length === 1 ? "" : "s"}</p></div></div>
                <div className="module-list">
                  {editor.adci_modules.map((module) => (
                    <article key={module.id}>
                      <header><span><Layers3 size={16} /></span><div><strong>{module.position}. {module.title}</strong><small>{module.adci_lessons.length} lesson{module.adci_lessons.length === 1 ? "" : "s"}</small></div><button className="icon-danger" disabled={saving} onClick={() => void removeEntity("module", module.id, `module "${module.title}" and its lessons`, module.adci_lessons)} aria-label={`Delete ${module.title}`}><Trash2 size={15} /></button></header>
                      <div className="module-lessons">
                        {module.adci_lessons.map((lesson) => <div key={lesson.id}><CirclePlay size={15} /><span><strong>{lesson.position}. {lesson.title}</strong><small>{lesson.lesson_type} · {Math.round(lesson.duration_seconds / 60)} min{lesson.adci_lesson_assets?.[0] ? ` · ${lesson.adci_lesson_assets[0].original_name}` : ""}</small></span><em className={lesson.adci_lesson_assets?.length ? "asset-ready" : ""}>{lesson.adci_lesson_assets?.length ? "file ready" : lesson.status}</em><button className="icon-danger" disabled={saving} onClick={() => void removeEntity("lesson", lesson.id, `lesson "${lesson.title}"`, [lesson])} aria-label={`Delete ${lesson.title}`}><Trash2 size={14} /></button></div>)}
                        {module.adci_lessons.length === 0 && <p>No lessons yet.</p>}
                      </div>
                    </article>
                  ))}
                </div>
                <div className="curriculum-actions">
                  <form onSubmit={addModule}><strong>Add module</strong><div><input required value={newModuleTitle} onChange={(event) => setNewModuleTitle(event.target.value)} placeholder="Module title" /><button disabled={saving}><Plus size={15} /> Add</button></div></form>
                  <form onSubmit={addLesson}><strong>Add lesson</strong><select required value={lessonModuleId} onChange={(event) => setLessonModuleId(event.target.value)}>{editor.adci_modules.map((module) => <option key={module.id} value={module.id}>{module.title}</option>)}</select><input required value={newLessonTitle} onChange={(event) => setNewLessonTitle(event.target.value)} placeholder="Lesson title" /><div><select value={newLessonType} onChange={(event) => { setNewLessonType(event.target.value as AdciLesson["lesson_type"]); setNewLessonFile(null); }}><option value="video">Video</option><option value="html">Article</option><option value="pdf">PDF</option><option value="live">Live class</option><option value="quiz">Quiz</option><option value="audio">Audio</option></select><input min="0" type="number" value={newLessonMinutes} onChange={(event) => setNewLessonMinutes(event.target.value)} aria-label="Duration in minutes" /><button disabled={saving || !lessonModuleId}><Plus size={15} /> Add</button></div>{(newLessonType === "video" || newLessonType === "audio" || newLessonType === "pdf") && <label className="lesson-asset-picker"><input required type="file" accept={newLessonType === "video" ? "video/mp4,video/webm" : newLessonType === "audio" ? "audio/mpeg,audio/mp4,audio/wav,audio/ogg" : "application/pdf"} onChange={(event) => setNewLessonFile(event.target.files?.[0] ?? null)} /><span><UploadCloud size={16} />{newLessonFile ? newLessonFile.name : `Choose ${newLessonType.toUpperCase()} file`}</span></label>}{saving && lessonUploadProgress > 0 && <div className="lesson-upload-meter"><i><b style={{ width: `${lessonUploadProgress}%` }} /></i><small>{lessonUploadProgress}% uploaded</small></div>}</form>
                </div>
              </section>
            </div>
            {error && <div className="course-error">{error}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
