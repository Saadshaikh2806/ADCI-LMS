"use client";

import { Check, Clipboard, KeyRound, LoaderCircle, LockKeyhole, Video, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "../lib/supabase/client";

const ACTIVE_ZOOM_KEY = "adci-active-zoom-live";
const OPEN_ZOOM_EVENT = "adci-open-zoom-live";
const LESSON_ID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

type ZoomCredentials = {
  requiresCode: false;
  sdkKey: string;
  signature: string;
  meetingNumber: string;
  password: string;
  userName: string;
  userEmail: string;
  tk?: string;
  zak?: string;
};

type CodePrompt = { requiresCode: true; personalCode: string };

export function openZoomLive(lessonId: string) {
  if (LESSON_ID_PATTERN.test(lessonId)) {
    window.dispatchEvent(new CustomEvent(OPEN_ZOOM_EVENT, { detail: lessonId }));
  }
}

export function PersistentZoomLive({ notify, userId }: { notify: (message: string) => void; userId: string }) {
  const [active, setActive] = useState<{ lessonId: string; code: string } | null>(null);

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
          code?: string;
        } | null;
        if (saved?.userId === userId && saved.lessonId && LESSON_ID_PATTERN.test(saved.lessonId)) {
          setActive({ lessonId: saved.lessonId, code: saved.code || "" });
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
      window.sessionStorage.setItem(ACTIVE_ZOOM_KEY, JSON.stringify({ userId, lessonId, code: "" }));
      setActive({ lessonId, code: "" });
    };
    window.addEventListener(OPEN_ZOOM_EVENT, open);
    return () => window.removeEventListener(OPEN_ZOOM_EVENT, open);
  }, [userId]);

  if (!active) return null;
  const close = () => {
    window.sessionStorage.removeItem(ACTIVE_ZOOM_KEY);
    setActive(null);
  };
  return <ZoomLive
    lessonId={active.lessonId}
    initialCode={active.code}
    notify={notify}
    close={close}
    rememberCode={(code) => {
      window.sessionStorage.setItem(ACTIVE_ZOOM_KEY, JSON.stringify({ userId, lessonId: active.lessonId, code }));
    }}
  />;
}

function ZoomLive({ lessonId, initialCode, notify, close, rememberCode }: {
  lessonId: string;
  initialCode: string;
  notify: (message: string) => void;
  close: () => void;
  rememberCode: (code: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [personalCode, setPersonalCode] = useState("");
  const [code, setCode] = useState(initialCode);
  const started = useRef(false);

  const requestAccess = useCallback(async (meetingCode?: string) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) throw new Error("The learning platform is not configured");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Sign in again to open Zoom Live");
    const response = await fetch("/api/live-sessions/zoom", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ lessonId, code: meetingCode || undefined })
    });
    const result = await response.json() as (ZoomCredentials | CodePrompt) & { error?: string };
    if (!response.ok) throw new Error(result.error || "Zoom Live could not be opened");
    return result;
  }, [lessonId]);

  const startMeeting = useCallback(async (credentials: ZoomCredentials) => {
    if (started.current) return;
    started.current = true;
    setJoining(true);
    setError("");
    try {
      const { ZoomMtg } = await import("@zoom/meetingsdk");
      ZoomMtg.preLoadWasm();
      ZoomMtg.prepareWebSDK();
      const root = document.getElementById("zmmtg-root");
      if (root) root.style.display = "block";
      ZoomMtg.init({
        leaveUrl: `${window.location.origin}${window.location.pathname}?zoomLeft=1`,
        patchJsMedia: true,
        leaveOnPageUnload: true,
        disableInvite: true,
        disableCallOut: true,
        defaultView: "gallery",
        meetingInfo: ["topic", "host", "participant"],
        success: () => ZoomMtg.join({
          meetingNumber: credentials.meetingNumber,
          signature: credentials.signature,
          userName: credentials.userName,
          userEmail: credentials.userEmail,
          passWord: credentials.password,
          tk: credentials.tk,
          zak: credentials.zak,
          customerKey: lessonId,
          success: () => setJoining(false),
          error: (joinError: unknown) => {
            started.current = false;
            setJoining(false);
            setError(typeof joinError === "object" ? "Zoom could not join this meeting. Please try again." : String(joinError));
            if (root) root.style.display = "none";
          }
        }),
        error: () => {
          started.current = false;
          setJoining(false);
          setError("Zoom could not start in this browser. Please update the browser and try again.");
          if (root) root.style.display = "none";
        }
      });
    } catch (meetingError) {
      started.current = false;
      setJoining(false);
      setError(meetingError instanceof Error ? meetingError.message : "Zoom Live could not start");
    }
  }, [lessonId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        let result;
        try {
          result = await requestAccess(initialCode || undefined);
        } catch (savedCodeError) {
          if (!initialCode) throw savedCodeError;
          window.sessionStorage.removeItem(ACTIVE_ZOOM_KEY);
          setCode("");
          result = await requestAccess();
        }
        if (cancelled) return;
        if (result.requiresCode) {
          setPersonalCode(result.personalCode);
          setLoading(false);
        } else {
          await startMeeting(result);
          if (!cancelled) setLoading(false);
        }
      } catch (accessError) {
        if (!cancelled) {
          setError(accessError instanceof Error ? accessError.message : "Zoom Live could not be opened");
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [initialCode, requestAccess, startMeeting]);

  async function join() {
    setJoining(true);
    setError("");
    try {
      const result = await requestAccess(code);
      if (result.requiresCode) throw new Error("Enter your personal meeting code");
      rememberCode(code.trim().toUpperCase());
      await startMeeting(result);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Zoom Live could not be opened");
      setJoining(false);
    }
  }

  async function copyCode() {
    await navigator.clipboard.writeText(personalCode);
    notify("Personal Zoom Live code copied");
  }

  return <div className="zoom-live-backdrop" role="dialog" aria-modal="true" aria-label="Zoom Live">
    <section className="zoom-live-gate">
      <header><div><Video /><span><strong>Zoom Live</strong><small>Private paid live session</small></span></div><button aria-label="Close Zoom Live" disabled={joining} onClick={close}><X /></button></header>
      {loading || joining ? <div className="zoom-live-state"><LoaderCircle className="spin" /><strong>{joining ? "Starting Zoom Live…" : "Verifying your access…"}</strong><p>Keep this page open.</p></div> : <>
        <div className="zoom-live-shield"><LockKeyhole /></div>
        <p className="eyebrow">ACCOUNT-BOUND ACCESS</p>
        <h2>Enter your Zoom Live code</h2>
        <p>Your purchase is verified automatically. This code is different for every learner and works only with the account that bought this session.</p>
        <div className="zoom-personal-code"><span>Your personal meeting code</span><strong>{personalCode}</strong><button onClick={() => void copyCode()}><Clipboard /> Copy</button></div>
        <label><span>Meeting code</span><div><KeyRound /><input autoFocus autoComplete="one-time-code" maxLength={12} placeholder="ABCD-EFGH" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} /></div></label>
        {error && <div className="course-error">{error}</div>}
        <button className="zoom-live-join" disabled={(code.match(/[A-Z0-9]/g)?.length ?? 0) !== 8} onClick={() => void join()}><Check /> Join Zoom Live</button>
        <small className="zoom-live-note">The meeting link and Zoom participant token are never displayed or shared.</small>
      </>}
    </section>
  </div>;
}
