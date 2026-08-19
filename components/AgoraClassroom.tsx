"use client";

import type { IAgoraRTCClient, IAgoraRTCRemoteUser, ICameraVideoTrack, IMicrophoneAudioTrack, RemoteStreamType } from "agora-rtc-sdk-ng";
import { ChevronLeft, ChevronRight, LayoutGrid, LoaderCircle, Maximize2, Mic, MicOff, Minimize2, PhoneOff, Pin, ShieldCheck, Users, Video, VideoOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "../lib/supabase/client";

type ClassroomCredentials = { appId: string; token: string; channel: string; uid: string; name: string; isStaff: boolean };
type MeetingParticipant = {
  key: string;
  name: string;
  isHost: boolean;
  isLocal: boolean;
  hasAudio: boolean;
  hasVideo: boolean;
  user?: IAgoraRTCRemoteUser;
};

const ACTIVE_CLASSROOM_KEY = "adci-active-classroom";
const OPEN_CLASSROOM_EVENT = "adci-open-classroom";
const LESSON_ID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function openAgoraClassroom(lessonId: string) {
  if (!LESSON_ID_PATTERN.test(lessonId)) return;
  window.dispatchEvent(new CustomEvent(OPEN_CLASSROOM_EVENT, { detail: lessonId }));
}

export function PersistentAgoraClassroom({ notify, userId }: { notify: (message: string) => void; userId: string }) {
  const [lessonId, setLessonId] = useState("");

  useEffect(() => {
    setLessonId("");
    const savedClassroom = window.sessionStorage.getItem(ACTIVE_CLASSROOM_KEY);
    if (savedClassroom) {
      try {
        const saved = JSON.parse(savedClassroom) as { userId?: string; lessonId?: string };
        if (saved.userId === userId && saved.lessonId && LESSON_ID_PATTERN.test(saved.lessonId)) setLessonId(saved.lessonId);
        else window.sessionStorage.removeItem(ACTIVE_CLASSROOM_KEY);
      } catch {
        window.sessionStorage.removeItem(ACTIVE_CLASSROOM_KEY);
      }
    }

    const open = (event: Event) => {
      const nextLessonId = (event as CustomEvent<string>).detail;
      if (!userId || !LESSON_ID_PATTERN.test(nextLessonId)) return;
      window.sessionStorage.setItem(ACTIVE_CLASSROOM_KEY, JSON.stringify({ userId, lessonId: nextLessonId }));
      setLessonId(nextLessonId);
    };
    window.addEventListener(OPEN_CLASSROOM_EVENT, open);
    return () => window.removeEventListener(OPEN_CLASSROOM_EVENT, open);
  }, [userId]);

  if (!lessonId) return null;
  return <AgoraClassroom lessonId={lessonId} notify={notify} close={() => {
    window.sessionStorage.removeItem(ACTIVE_CLASSROOM_KEY);
    setLessonId("");
  }} />;
}

function rtcIdentity(uid: string | number) {
  const parts = String(uid).split(":");
  if (parts.length >= 3 && (parts[1] === "host" || parts[1] === "learner")) {
    return { name: parts.slice(2).join(":") || "Participant", isHost: parts[1] === "host" };
  }
  return { name: parts.length > 1 ? parts.slice(1).join(":") || "Participant" : "Participant", isHost: false };
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function pageSizeForViewport() {
  if (window.innerWidth <= 700) return window.innerWidth > window.innerHeight ? 6 : 4;
  if (window.innerWidth <= 1050) return 6;
  return 9;
}

function RemoteVideo({ participant, active, focused, compact, onFocus }: {
  participant: MeetingParticipant;
  active: boolean;
  focused: boolean;
  compact?: boolean;
  onFocus: () => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const user = participant.user as IAgoraRTCRemoteUser;

  useEffect(() => {
    if (element.current && user.hasVideo && user.videoTrack) user.videoTrack.play(element.current, { fit: "contain" });
    return () => user.videoTrack?.stop();
  }, [user.hasVideo, user.videoTrack]);

  return <article className={`agora-video-tile${participant.isHost ? " host" : ""}${active ? " speaking" : ""}${focused ? " focused" : ""}${compact ? " compact" : ""}`}>
    <div ref={element} />
    {!user.hasVideo && <div className="agora-video-placeholder"><span>{initials(participant.name)}</span><VideoOff /></div>}
    <button className="agora-pin" aria-label={`Focus ${participant.name}`} title={`Focus ${participant.name}`} onClick={onFocus}><Pin /></button>
    <span>{participant.name}{participant.isHost ? " · Host" : ""}{!user.hasAudio ? " · Mic off" : ""}</span>
  </article>;
}

function LocalVideo({ participant, track, cameraOff, active, focused, compact, onFocus }: {
  participant: MeetingParticipant;
  track: ICameraVideoTrack | null;
  cameraOff: boolean;
  active: boolean;
  focused: boolean;
  compact?: boolean;
  onFocus: () => void;
}) {
  const element = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (element.current && track && !cameraOff) track.play(element.current, { fit: "contain", mirror: true });
    return () => track?.stop();
  }, [track, cameraOff]);

  return <article className={`agora-video-tile local${participant.isHost ? " host" : ""}${active ? " speaking" : ""}${focused ? " focused" : ""}${compact ? " compact" : ""}`}>
    <div ref={element} />
    {(!track || cameraOff) && <div className="agora-video-placeholder"><span>{initials(participant.name)}</span><VideoOff /></div>}
    <button className="agora-pin" aria-label="Focus your video" title="Focus your video" onClick={onFocus}><Pin /></button>
    <span>{participant.name} {participant.isHost ? "· Host" : "· You"}{!participant.hasAudio ? " · Mic off" : ""}</span>
  </article>;
}

export default function AgoraClassroom({ lessonId, close, notify }: { lessonId: string; close: () => void; notify: (message: string) => void }) {
  const classroomRef = useRef<HTMLElement>(null);
  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const microphoneRef = useRef<IMicrophoneAudioTrack | null>(null);
  const cameraRef = useRef<ICameraVideoTrack | null>(null);
  const notifyRef = useRef(notify);
  const [credentials, setCredentials] = useState<ClassroomCredentials | null>(null);
  const [remoteUsers, setRemoteUsers] = useState<IAgoraRTCRemoteUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [microphoneOff, setMicrophoneOff] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [, refreshLocalMedia] = useState(0);
  const [connectionState, setConnectionState] = useState("Connecting");
  const [layout, setLayout] = useState<"grid" | "focus">("grid");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(9);
  const [focusedUid, setFocusedUid] = useState("");
  const [activeSpeakerUid, setActiveSpeakerUid] = useState("");
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => { notifyRef.current = notify; }, [notify]);

  useEffect(() => {
    const updatePageSize = () => setPageSize(pageSizeForViewport());
    updatePageSize();
    window.addEventListener("resize", updatePageSize);
    return () => window.removeEventListener("resize", updatePageSize);
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    const updateFullscreen = () => setFullscreen(document.fullscreenElement === classroomRef.current);
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () => document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  useEffect(() => {
    let active = true;
    let client: IAgoraRTCClient | null = null;

    async function connect() {
      try {
        const { default: AgoraRTC } = await import("agora-rtc-sdk-ng");
        if (!active) return;
        client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
        clientRef.current = client;
        const showRemoteUser = (user: IAgoraRTCRemoteUser) => {
          if (active) setRemoteUsers((current) => {
            const index = current.findIndex((item) => item.uid === user.uid);
            if (index === -1) return [...current, user];
            const next = [...current];
            next[index] = user;
            return next;
          });
        };
        client.on("user-joined", showRemoteUser);
        client.on("user-published", async (user, mediaType) => {
          if (!client) return;
          await client.subscribe(user, mediaType);
          if (mediaType === "audio") user.audioTrack?.play();
          showRemoteUser(user);
        });
        client.on("user-unpublished", showRemoteUser);
        client.on("user-left", (user) => {
          if (!active) return;
          setRemoteUsers((current) => current.filter((item) => item.uid !== user.uid));
          setActiveSpeakerUid((current) => current === String(user.uid) ? "" : current);
        });
        client.on("volume-indicator", (volumes) => {
          if (!active) return;
          const loudest = volumes.filter((volume) => volume.level >= 55).sort((a, b) => b.level - a.level)[0];
          setActiveSpeakerUid(loudest ? String(loudest.uid) : "");
        });
        client.on("connection-state-change", (currentState) => {
          if (!active) return;
          setConnectionState(currentState === "CONNECTED" ? "Connected" : currentState === "RECONNECTING" ? "Reconnecting" : currentState === "DISCONNECTED" ? "Disconnected" : "Connecting");
        });

        const supabase = getSupabaseBrowserClient();
        if (!supabase) throw new Error("The LMS connection is unavailable");
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error("Please sign in again to enter this classroom");

        const response = await fetch("/api/live-sessions/token", {
          method: "POST",
          headers: { authorization: `Bearer ${session.access_token}`, "content-type": "application/json" },
          body: JSON.stringify({ lessonId })
        });
        const result = await response.json() as ClassroomCredentials & { error?: string };
        if (!response.ok) throw new Error(result.error || "Unable to enter the private classroom");

        await client.join(result.appId, result.channel, result.token, result.uid);
        client.enableAudioVolumeIndicator();
        await client.enableDualStream().catch(() => undefined);
        setConnectionState("Connected");
        const [microphone, camera] = await Promise.allSettled([AgoraRTC.createMicrophoneAudioTrack(), AgoraRTC.createCameraVideoTrack()]);
        if (microphone.status === "fulfilled") microphoneRef.current = microphone.value;
        if (camera.status === "fulfilled") cameraRef.current = camera.value;
        const localTracks = [microphoneRef.current, cameraRef.current].filter(Boolean) as Array<IMicrophoneAudioTrack | ICameraVideoTrack>;
        if (localTracks.length) await client.publish(localTracks);

        if (!active) return;
        setCredentials(result);
        setError([
          microphone.status === "rejected" ? "Microphone access was blocked or unavailable." : "",
          camera.status === "rejected" ? "Camera access was blocked or unavailable. Allow it in your browser's site settings, then rejoin." : ""
        ].filter(Boolean).join(" "));
        notifyRef.current("Joined the private live classroom");
      } catch (joinError) {
        if (active) setError(joinError instanceof Error ? joinError.message : "Unable to enter the private classroom");
      } finally {
        if (active) setLoading(false);
      }
    }

    void connect();
    return () => {
      active = false;
      microphoneRef.current?.close();
      cameraRef.current?.close();
      if (client) void client.leave();
    };
  }, [lessonId]);

  const participants: MeetingParticipant[] = [
    ...(credentials ? [{ key: credentials.uid, name: credentials.name, isHost: credentials.isStaff, isLocal: true, hasAudio: Boolean(microphoneRef.current) && !microphoneOff, hasVideo: Boolean(cameraRef.current) && !cameraOff }] : []),
    ...remoteUsers.map((user) => {
      const identity = rtcIdentity(user.uid);
      return { key: String(user.uid), name: identity.name, isHost: identity.isHost, isLocal: false, hasAudio: user.hasAudio, hasVideo: user.hasVideo, user };
    })
  ];
  const pageCount = Math.max(1, Math.ceil(participants.length / pageSize));
  const visibleParticipants = participants.slice(page * pageSize, (page + 1) * pageSize);
  const focusParticipant = participants.find((participant) => participant.key === focusedUid) ?? participants[0];
  const focusIndex = focusParticipant ? participants.findIndex((participant) => participant.key === focusParticipant.key) : 0;
  const filmstripParticipants = focusParticipant ? participants.filter((participant) => participant.key !== focusParticipant.key).slice(0, 5) : [];
  const participantKeys = participants.map((participant) => participant.key).join("|");
  const qualitySignature = `${layout}:${participants.length}:${focusParticipant?.key ?? ""}:${visibleParticipants.map((participant) => participant.key).join("|")}`;

  useEffect(() => { setPage((current) => Math.min(current, pageCount - 1)); }, [pageCount]);

  useEffect(() => {
    if (layout === "focus" && participants.length && !participants.some((participant) => participant.key === focusedUid)) setFocusedUid(participants[0].key);
  }, [focusedUid, layout, participantKeys]);

  useEffect(() => {
    const client = clientRef.current;
    if (!client || !credentials) return;
    const visibleKeys = new Set((layout === "grid" ? visibleParticipants : [focusParticipant, ...filmstripParticipants]).filter(Boolean).map((participant) => participant?.key));
    remoteUsers.forEach((user) => {
      const key = String(user.uid);
      const highQuality = layout === "focus" ? focusParticipant?.key === key : participants.length <= 4 && visibleKeys.has(key);
      void client.setRemoteVideoStreamType(user.uid, (highQuality ? 0 : 1) as RemoteStreamType).catch(() => undefined);
    });
  }, [credentials, qualitySignature, remoteUsers]);

  function focusParticipantByKey(key: string) {
    setFocusedUid(key);
    setLayout("focus");
    setParticipantsOpen(false);
  }

  function toggleLayout() {
    if (layout === "focus") return setLayout("grid");
    const preferred = participants.find((participant) => participant.key === activeSpeakerUid) ?? participants.find((participant) => !participant.isLocal && participant.isHost) ?? participants[0];
    if (preferred) setFocusedUid(preferred.key);
    setLayout("focus");
  }

  function previousView() {
    if (layout === "grid") return setPage((current) => Math.max(0, current - 1));
    if (participants.length > 1) setFocusedUid(participants[(focusIndex - 1 + participants.length) % participants.length].key);
  }

  function nextView() {
    if (layout === "grid") return setPage((current) => Math.min(pageCount - 1, current + 1));
    if (participants.length > 1) setFocusedUid(participants[(focusIndex + 1) % participants.length].key);
  }

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches("input,textarea,select")) return;
      if (event.key === "Escape") {
        if (participantsOpen) setParticipantsOpen(false);
        else if (layout === "focus") setLayout("grid");
      } else if (event.key === "ArrowLeft") previousView();
      else if (event.key === "ArrowRight") nextView();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [focusIndex, layout, pageCount, participantKeys, participantsOpen]);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await classroomRef.current?.requestFullscreen();
    } catch {
      setError("Fullscreen is unavailable in this browser.");
    }
  }

  async function toggleMicrophone() {
    try {
      let microphone = microphoneRef.current;
      if (!microphone) {
        const { default: AgoraRTC } = await import("agora-rtc-sdk-ng");
        microphone = await AgoraRTC.createMicrophoneAudioTrack();
        microphoneRef.current = microphone;
        await clientRef.current?.publish(microphone);
        setMicrophoneOff(false);
        refreshLocalMedia((current) => current + 1);
        setError("");
        return;
      }
      await microphone.setEnabled(microphoneOff);
      setMicrophoneOff(!microphoneOff);
    } catch {
      setError("Microphone access was blocked or unavailable. Allow it in your browser's site settings and try again.");
    }
  }

  async function toggleCamera() {
    try {
      let camera = cameraRef.current;
      if (!camera) {
        const { default: AgoraRTC } = await import("agora-rtc-sdk-ng");
        camera = await AgoraRTC.createCameraVideoTrack();
        cameraRef.current = camera;
        await clientRef.current?.publish(camera);
        setCameraOff(false);
        refreshLocalMedia((current) => current + 1);
        setError("");
        return;
      }
      await camera.setEnabled(cameraOff);
      setCameraOff(!cameraOff);
    } catch {
      setError("Camera access was blocked or unavailable. Allow it in your browser's site settings and try again.");
    }
  }

  function renderParticipant(participant: MeetingParticipant, compact = false) {
    const common = { participant, active: participant.key === activeSpeakerUid, focused: layout === "focus" && participant.key === focusParticipant?.key, compact, onFocus: () => focusParticipantByKey(participant.key) };
    return participant.isLocal ? <LocalVideo key={participant.key} {...common} track={cameraRef.current} cameraOff={cameraOff} /> : <RemoteVideo key={participant.key} {...common} />;
  }

  const previousDisabled = layout === "grid" ? page === 0 : participants.length < 2;
  const nextDisabled = layout === "grid" ? page >= pageCount - 1 : participants.length < 2;
  const positionLabel = layout === "grid" ? `${page + 1} / ${pageCount}` : `${focusIndex + 1} / ${Math.max(1, participants.length)}`;

  return <div className="agora-classroom-backdrop">
    <section ref={classroomRef} className="agora-classroom" role="dialog" aria-modal="true" aria-label="Private live classroom">
      <header>
        <div><ShieldCheck /><span><strong>Private ADCI classroom</strong><small>Automatic purchase verification · No shareable meeting link</small></span></div>
        <span aria-live="polite" className={`agora-connection ${connectionState.toLowerCase()}`}><i /> {connectionState} · <Users /> {participants.length}</span>
      </header>

      {loading ? <div className="agora-classroom-state"><LoaderCircle className="spin" /><strong>Verifying access and connecting…</strong></div>
      : error && !credentials ? <div className="agora-classroom-state error"><ShieldCheck /><strong>Unable to join</strong><p>{error}</p><button onClick={close}>Close</button></div>
      : <>
        {error && <div className="agora-classroom-warning" role="status">{error}</div>}
        <main className={`agora-meeting-stage ${layout}`}>
          {layout === "grid" ? <div className="agora-video-grid" data-count={visibleParticipants.length}>
            {visibleParticipants.map((participant) => renderParticipant(participant))}
            {participants.length === 1 && <div className="agora-waiting"><Users /><strong>Waiting for others to join</strong><p>Only authorised accounts can enter this room.</p></div>}
          </div> : focusParticipant && <div className="agora-focus-layout">
            <div className="agora-focus-stage">{renderParticipant(focusParticipant)}</div>
            {filmstripParticipants.length > 0 && <div className="agora-filmstrip">{filmstripParticipants.map((participant) => renderParticipant(participant, true))}</div>}
          </div>}
        </main>

        {participantsOpen && <aside className="agora-participants-panel" aria-label="Participants">
          <header><div><Users /><strong>Participants</strong><span>{participants.length}</span></div><button aria-label="Close participants" onClick={() => setParticipantsOpen(false)}><X /></button></header>
          <div>{participants.map((participant) => <button key={participant.key} className={participant.key === focusParticipant?.key && layout === "focus" ? "selected" : ""} onClick={() => focusParticipantByKey(participant.key)}>
            <span className="agora-participant-avatar">{initials(participant.name)}</span>
            <span><strong>{participant.name}{participant.isLocal ? " (You)" : ""}</strong><small>{participant.isHost ? "Host" : "Participant"}</small></span>
            <span className="agora-participant-devices">{participant.hasAudio ? <Mic /> : <MicOff />}{participant.hasVideo ? <Video /> : <VideoOff />}</span>
          </button>)}</div>
        </aside>}

        <footer>
          <div className="agora-view-navigation">
            <button aria-label="Previous view" title="Previous view" disabled={previousDisabled} onClick={previousView}><ChevronLeft /></button>
            <span aria-live="polite">{positionLabel}</span>
            <button aria-label="Next view" title="Next view" disabled={nextDisabled} onClick={nextView}><ChevronRight /></button>
          </div>
          <div className="agora-call-controls">
            <button disabled={!credentials} className={!microphoneRef.current || microphoneOff ? "off" : ""} onClick={() => void toggleMicrophone()}>{!microphoneRef.current || microphoneOff ? <MicOff /> : <Mic />}<span>{!microphoneRef.current || microphoneOff ? "Unmute" : "Mute"}</span></button>
            <button disabled={!credentials} className={!cameraRef.current || cameraOff ? "off" : ""} onClick={() => void toggleCamera()}>{!cameraRef.current || cameraOff ? <VideoOff /> : <Video />}<span>{!cameraRef.current || cameraOff ? "Start video" : "Stop video"}</span></button>
            <button className="leave" onClick={close}><PhoneOff /><span>Leave</span></button>
          </div>
          <div className="agora-meeting-tools">
            <button aria-label={`Switch to ${layout === "grid" ? "focus" : "grid"} view`} title={`Switch to ${layout === "grid" ? "focus" : "grid"} view`} aria-pressed={layout === "focus"} onClick={toggleLayout}><LayoutGrid /><span>{layout === "grid" ? "Focus" : "Grid"}</span></button>
            <button aria-label="Show participants" title="Show participants" aria-pressed={participantsOpen} onClick={() => setParticipantsOpen((open) => !open)}><Users /><span>People</span></button>
            <button aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} title={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize2 /> : <Maximize2 />}<span>Full screen</span></button>
          </div>
        </footer>
      </>}
    </section>
  </div>;
}
