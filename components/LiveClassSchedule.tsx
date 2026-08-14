"use client";

import { LoaderCircle, RefreshCw, Video } from "lucide-react";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "../lib/supabase/client";
import { openAgoraClassroom } from "./AgoraClassroom";

type LiveClass = {
  lesson_id: string;
  lesson_title: string;
  course_title: string;
  module_title: string;
  provider: "agora" | "zoom" | "youtube_live";
  instructor_name: string;
  starts_at: string;
  ends_at: string;
  can_join: boolean;
  has_attended: boolean;
};

const providerNames = {
  agora: "ADCI Live Classroom",
  zoom: "Zoom",
  youtube_live: "YouTube Live"
};

export default function LiveClassSchedule({ notify }: { notify: (message: string) => void }) {
  const [classes, setClasses] = useState<LiveClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { setLoading(false); return; }
    setLoading(true); setError("");
    const { data, error: loadError } = await supabase.rpc("adci_get_my_live_classes");
    if (loadError) setError(loadError.message);
    else setClasses((data ?? []) as LiveClass[]);
    setLoading(false);
  }

  useEffect(() => { void refresh(); }, []);

  async function join(liveClass: LiveClass) {
    if (liveClass.provider === "agora") {
      openAgoraClassroom(liveClass.lesson_id);
      return;
    }
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      setError("Your browser blocked the meeting tab. Allow pop-ups for this LMS and try again.");
      return;
    }
    popup.opener = null;
    popup.document.title = "Opening live class";
    popup.document.body.textContent = "Opening your live class…";
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { popup.close(); return; }
    setJoining(liveClass.lesson_id);
    const { data, error: joinError } = await supabase.rpc("adci_join_live_class", {
      target_lesson_id: liveClass.lesson_id
    });
    if (joinError) {
      popup.close();
      setError(joinError.message);
    } else {
      popup.location.replace(data as string);
      notify("Attendance recorded. Opening live class.");
      await refresh();
    }
    setJoining("");
  }

  if (loading) return <div className="live-schedule-state"><LoaderCircle className="spin" /><span>Loading classes…</span></div>;
  if (error && classes.length === 0) return <div className="live-schedule-state error"><span>{error}</span><button onClick={() => void refresh()}><RefreshCw size={14} /> Retry</button></div>;
  if (classes.length === 0) return <div className="live-schedule-state"><Video size={20} /><span>No live classes are scheduled yet.</span></div>;

  return <><div className="timeline">{classes.slice(0, 4).map((liveClass) => {
    const start = new Date(liveClass.starts_at);
    const ended = new Date(liveClass.ends_at).getTime() < Date.now();
    return <article className="event" key={liveClass.lesson_id}>
      <div className="event-time"><strong>{start.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }).replace(/\s?[AP]M/i, "")}</strong><span>{start.toLocaleTimeString("en-IN", { hour: "2-digit", hour12: true }).slice(-2)}</span></div>
      <div className={`event-dot ${liveClass.can_join ? "is-live" : ""}`}><Video size={14} /></div>
      <div className="event-copy"><div><span>{providerNames[liveClass.provider]}</span>{liveClass.can_join && <em>LIVE</em>}</div><h4>{liveClass.lesson_title}</h4><p>{liveClass.instructor_name} · {liveClass.course_title}</p></div>
      <button disabled={!liveClass.can_join || joining === liveClass.lesson_id || ended} onClick={() => void join(liveClass)}>{joining === liveClass.lesson_id ? "Opening…" : ended ? (liveClass.has_attended ? "Attended" : "Ended") : liveClass.can_join ? "Join class" : start.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</button>
    </article>;
  })}</div></>;
}
