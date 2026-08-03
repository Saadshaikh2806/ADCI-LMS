"use client";

import { FileText, LoaderCircle, Radio, Save, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  getAdciArticle,
  getAdciLiveClass,
  saveAdciArticle,
  saveAdciLiveClass,
  type AdciLesson,
  type AdciLiveClass
} from "../lib/supabase/admin";

function localDateTime(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function AdminLessonContentEditor({ lesson, close, notify, saved }: {
  lesson: AdciLesson; close: () => void; notify: (message: string) => void; saved?: () => Promise<void>;
}) {
  const isArticle = lesson.lesson_type === "html";
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [provider, setProvider] = useState<AdciLiveClass["provider"]>("google_meet");
  const [url, setUrl] = useState("");
  const [instructor, setInstructor] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  useEffect(() => {
    (isArticle ? getAdciArticle(lesson.id) : getAdciLiveClass(lesson.id)).then((data) => {
      if (isArticle) setBody((data as { body: string } | null)?.body ?? "");
      else if (data) {
        const live = data as AdciLiveClass;
        setProvider(live.provider); setUrl(live.meeting_url); setInstructor(live.instructor_name);
        setStartsAt(localDateTime(live.starts_at)); setEndsAt(localDateTime(live.ends_at));
      }
    }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load lesson content")).finally(() => setLoading(false));
  }, [isArticle, lesson.id]);

  async function save(event: React.FormEvent) {
    event.preventDefault(); setError("");
    const startDate = new Date(startsAt);
    const endDate = new Date(endsAt);
    if (!isArticle) {
      if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) {
        setError("Choose valid start and end times.");
        return;
      }
      if (endDate <= startDate) {
        setError("The live class must end after it starts.");
        return;
      }
      if (!url.trim().toLowerCase().startsWith("https://")) {
        setError("Enter a secure HTTPS meeting or stream URL.");
        return;
      }
      if (instructor.trim().length < 2) {
        setError("Enter the instructor name.");
        return;
      }
    }
    setSaving(true);
    try {
      if (isArticle) await saveAdciArticle(lesson.id, body);
      else await saveAdciLiveClass(lesson.id, {
        provider, meeting_url: url.trim(), instructor_name: instructor.trim(),
        starts_at: startDate.toISOString(), ends_at: endDate.toISOString()
      });
      notify(isArticle ? "Article saved" : "Live class scheduled");
      await saved?.();
      close();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String((saveError as { message?: string })?.message || "Unable to save"));
    } finally { setSaving(false); }
  }

  return <div className="course-dialog-backdrop"><form className="lesson-content-editor" onSubmit={save}>
    <div className="course-dialog-head"><div><p className="eyebrow">{isArticle ? "ARTICLE EDITOR" : "LIVE CLASS SCHEDULER"}</p><h2>{lesson.title}</h2></div><button type="button" onClick={close}><X /></button></div>
    {loading ? <div className="cms-loading"><LoaderCircle className="spin" /> Loading…</div> : isArticle ? <>
      <div className="content-editor-note"><FileText /><span><strong>Student reading content</strong><small>Use clear headings and short paragraphs. Content is stored as safe text.</small></span></div>
      <label><span>Article body</span><textarea required className="article-body-editor" value={body} onChange={(event) => setBody(event.target.value)} placeholder={"Introduction\n\nExplain the topic in clear sections…"} /></label>
    </> : <>
      <div className="content-editor-note"><Radio /><span><strong>External live classroom</strong><small>Students receive the meeting link through their protected course schedule.</small></span></div>
      <div className="live-class-grid"><label><span>Provider</span><select value={provider} onChange={(event) => setProvider(event.target.value as AdciLiveClass["provider"])}><option value="google_meet">Google Meet</option><option value="zoom">Zoom</option><option value="youtube_live">YouTube Live</option></select></label><label><span>Instructor</span><input required value={instructor} onChange={(event) => setInstructor(event.target.value)} /></label><label className="wide"><span>HTTPS meeting or stream URL</span><input required type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" /></label><label><span>Starts</span><input required type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label><label><span>Ends</span><input required type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label></div>
    </>}
    {error && <div className="course-error">{error}</div>}
    <div className="course-dialog-actions"><button type="button" onClick={close}>Cancel</button><button className="primary" disabled={saving}><Save size={16} /> {saving ? "Saving…" : isArticle ? "Save article" : "Schedule class"}</button></div>
  </form></div>;
}
