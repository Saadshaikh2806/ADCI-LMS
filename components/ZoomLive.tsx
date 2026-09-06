"use client";

import { Check, LoaderCircle, LockKeyhole, Video, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "../lib/supabase/client";

const ACTIVE_ZOOM_KEY = "adci-active-zoom-live";
const OPEN_ZOOM_EVENT = "adci-open-zoom-live";
const LESSON_ID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

type ZoomCredentials = {
  sdkKey: string;
  signature: string;
  meetingNumber: string;
  password: string;
  userName: string;
  userEmail: string;
  tk?: string;
  zak?: string;
};

function describeZoomError(error: unknown) {
  if (!error || typeof error !== "object") return String(error ?? "No reason reported");
  const { errorCode, errorMessage, message, reason, result } = error as Record<string, unknown>;
  const detail = [errorMessage, message, reason, result].find((value) => typeof value === "string");
  return [errorCode, detail].filter(Boolean).join(" · ") || JSON.stringify(error);
}

export function openZoomLive(lessonId: string) {
  if (LESSON_ID_PATTERN.test(lessonId)) {
    window.dispatchEvent(new CustomEvent(OPEN_ZOOM_EVENT, { detail: lessonId }));
  }
}

export function PersistentZoomLive({ userId }: { userId: string }) {
  const [active, setActive] = useState<{ lessonId: string } | null>(null);

  useEffect(() => {
    setActive(null);
    const query = new URLSearchParams(window.location.search);
    if (query.get("zoomLeft") === "1") {
      window.sessionStorage.removeItem(ACTIVE_ZOOM_KEY);
      query.delete("zoomLeft");
      window.history.replaceState({}, "", `${window.location.pathname}${query.size ? `?${query}` : ""}${window.location.hash}`);
    } else {
      try {
        const saved = JSON.parse(window.sessionStorage.getItem(ACTIVE_ZOOM_KEY) || "null") as {
          userId?: string;
          lessonId?: string;
        } | null;
        if (saved?.userId === userId && saved.lessonId && LESSON_ID_PATTERN.test(saved.lessonId)) {
          setActive({ lessonId: saved.lessonId });
        } else {
          window.sessionStorage.removeItem(ACTIVE_ZOOM_KEY);
        }
      } catch {
        window.sessionStorage.removeItem(ACTIVE_ZOOM_KEY);
      }
    }

    const open = (event: Event) => {
      const lessonId = (event as CustomEvent<string>).detail;
      if (!userId || !LESSON_ID_PATTERN.test(lessonId)) return;
      window.sessionStorage.setItem(ACTIVE_ZOOM_KEY, JSON.stringify({ userId, lessonId }));
      setActive({ lessonId });
    };
    window.addEventListener(OPEN_ZOOM_EVENT, open);
    return () => window.removeEventListener(OPEN_ZOOM_EVENT, open);
  }, [userId]);

  if (!active) return null;
  const close = () => {
    window.sessionStorage.removeItem(ACTIVE_ZOOM_KEY);
    setActive(null);
  };
  return <ZoomLive lessonId={active.lessonId} close={close} />;
}

function ZoomLive({ lessonId, close }: {
  lessonId: string;
  close: () => void;
}) {
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const started = useRef(false);

  const requestAccess = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) throw new Error("The learning platform is not configured");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Sign in again to open Zoom Live");
    const response = await fetch("/api/live-sessions/zoom", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ lessonId })
    });
    const result = await response.json() as ZoomCredentials & { error?: string };
    if (!response.ok) throw new Error(result.error || "Zoom Live could not be opened");
    return result;
  }, [lessonId]);

  const startMeeting = useCallback(async (credentials: ZoomCredentials) => {
    if (started.current) return;
    started.current = true;
    setJoining(true);
    setError("");
    const root = document.getElementById("zmmtg-root");
    let settled = false;
    const finish = (message?: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      setJoining(false);
      if (!message) return;
      started.current = false;
      setError(message);
      if (root) root.style.display = "none";
    };
    const timer = window.setTimeout(
      () => finish("Zoom did not respond. Check the browser console for the Zoom SDK error and try again."),
      45000
    );
    try {
      const { ZoomMtg } = await import("@zoom/meetingsdk");
      ZoomMtg.preLoadWasm();
      ZoomMtg.prepareWebSDK();
      if (root) root.style.display = "block";
      ZoomMtg.init({
        leaveUrl: `${window.location.origin}${window.location.pathname}?zoomLeft=1`,
        patchJsMedia: true,
        leaveOnPageUnload: true,
        disableInvite: true,
        disableCallOut: true,
        // Trim features that the embedded Web Meeting SDK does not support or that
        // do not belong in a paid class. Whiteboard / AI Companion / Notes / Apps
        // have no init flag; they are hidden with CSS in app/globals.css and are
        // best switched off at the Zoom account level.
        disableRecord: true,
        disableReport: true,
        disableZoomPhone: true,
        disablePictureInPicture: true,
        defaultView: "gallery",
        meetingInfo: ["topic", "host", "participant"],
        success: () => {
          // Zoom can now wait indefinitely for the learner on its preview screen.
          window.clearTimeout(timer);
          ZoomMtg.join({
            meetingNumber: credentials.meetingNumber,
            signature: credentials.signature,
            userName: credentials.userName,
            userEmail: credentials.userEmail,
            passWord: credentials.password,
            tk: credentials.tk,
            zak: credentials.zak,
            customerKey: lessonId,
            success: () => finish(),
            error: (joinError: unknown) => finish(`Zoom could not join this meeting. ${describeZoomError(joinError)}`)
          });
        },
        error: (initError: unknown) => finish(`Zoom could not start in this browser. ${describeZoomError(initError)}`)
      });
    } catch (meetingError) {
      finish(meetingError instanceof Error ? meetingError.message : "Zoom Live could not start");
    }
  }, [lessonId]);

  async function join() {
    setJoining(true);
    setError("");
    try {
      const result = await requestAccess();
      await startMeeting(result);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Zoom Live could not be opened");
      setJoining(false);
    }
  }

  return <div className="zoom-live-backdrop" role="dialog" aria-modal="true" aria-label="Zoom Live">
    <section className="zoom-live-gate">
      <header><div><Video /><span><strong>Zoom Live</strong><small>Private paid live session</small></span></div><button aria-label="Close Zoom Live" disabled={joining} onClick={close}><X /></button></header>
      {joining ? <div className="zoom-live-state"><LoaderCircle className="spin" /><strong>Starting Zoom Live…</strong><p>Verifying your session access securely.</p></div> : <>
        <div className="zoom-live-shield"><LockKeyhole /></div>
        <p className="eyebrow">ACCOUNT-BOUND ACCESS</p>
        <h2>Join your Zoom Live session</h2>
        <p>Your signed-in account, session access and joining window are verified automatically before Zoom opens.</p>
        {error && <div className="course-error">{error}</div>}
        <button className="zoom-live-join" onClick={() => void join()}><Check /> Join Zoom Live</button>
        <small className="zoom-live-note">The meeting link and Zoom participant token are never displayed or shared.</small>
      </>}
    </section>
  </div>;
}
