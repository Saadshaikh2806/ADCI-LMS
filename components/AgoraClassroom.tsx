"use client";

import type {
  IAgoraRTCClient,
  IAgoraRTCRemoteUser,
  ICameraVideoTrack,
  IMicrophoneAudioTrack
} from "agora-rtc-sdk-ng";
import { LoaderCircle, Mic, MicOff, PhoneOff, ShieldCheck, Users, Video, VideoOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "../lib/supabase/client";

type ClassroomCredentials = {
  appId: string;
  token: string;
  channel: string;
  uid: string;
  name: string;
  isStaff: boolean;
};

function RemoteVideo({ user }: { user: IAgoraRTCRemoteUser }) {
  const element = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (element.current && user.videoTrack) user.videoTrack.play(element.current);
    return () => user.videoTrack?.stop();
  }, [user, user.videoTrack]);

  return <article className="agora-video-tile">
    <div ref={element} />
    <span>Participant</span>
  </article>;
}

export default function AgoraClassroom({ lessonId, close, notify }: {
  lessonId: string;
  close: () => void;
  notify: (message: string) => void;
}) {
  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const microphoneRef = useRef<IMicrophoneAudioTrack | null>(null);
  const cameraRef = useRef<ICameraVideoTrack | null>(null);
  const localVideoElement = useRef<HTMLDivElement>(null);
  const notifyRef = useRef(notify);
  const [credentials, setCredentials] = useState<ClassroomCredentials | null>(null);
  const [remoteUsers, setRemoteUsers] = useState<IAgoraRTCRemoteUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [microphoneOff, setMicrophoneOff] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);

  useEffect(() => { notifyRef.current = notify; }, [notify]);

  useEffect(() => {
    let active = true;
    let client: IAgoraRTCClient | null = null;

    async function connect() {
      try {
        const { default: AgoraRTC } = await import("agora-rtc-sdk-ng");
        if (!active) return;
        client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
        clientRef.current = client;
        client.on("user-published", async (user, mediaType) => {
          if (!client) return;
          await client.subscribe(user, mediaType);
          if (mediaType === "audio") user.audioTrack?.play();
          if (mediaType === "video" && active) {
            setRemoteUsers((current) => [...current.filter((item) => item.uid !== user.uid), user]);
          }
        });
        client.on("user-unpublished", (user, mediaType) => {
          if (mediaType === "video" && active) {
            setRemoteUsers((current) => current.filter((item) => item.uid !== user.uid));
          }
        });
        client.on("user-left", (user) => {
          if (active) setRemoteUsers((current) => current.filter((item) => item.uid !== user.uid));
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
        const [microphone, camera] = await Promise.allSettled([
          AgoraRTC.createMicrophoneAudioTrack(),
          AgoraRTC.createCameraVideoTrack()
        ]);
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

  useEffect(() => {
    if (credentials && localVideoElement.current && cameraRef.current) {
      cameraRef.current.play(localVideoElement.current);
    }
  }, [credentials]);

  async function toggleMicrophone() {
    const microphone = microphoneRef.current;
    if (!microphone) return;
    await microphone.setEnabled(microphoneOff);
    setMicrophoneOff(!microphoneOff);
  }

  async function toggleCamera() {
    const camera = cameraRef.current;
    if (!camera) return;
    await camera.setEnabled(cameraOff);
    setCameraOff(!cameraOff);
  }

  return <div className="agora-classroom-backdrop">
    <section className="agora-classroom" aria-label="Private live classroom">
      <header>
        <div><ShieldCheck /><span><strong>Private ADCI classroom</strong><small>Automatic purchase verification · No shareable meeting link</small></span></div>
        <span><Users /> {remoteUsers.length + (credentials ? 1 : 0)} connected</span>
      </header>

      {loading ? <div className="agora-classroom-state"><LoaderCircle className="spin" /><strong>Verifying access and connecting…</strong></div>
      : error && !credentials ? <div className="agora-classroom-state error"><ShieldCheck /><strong>Unable to join</strong><p>{error}</p><button onClick={close}>Close</button></div>
      : <>
        {error && <div className="agora-classroom-warning">{error}</div>}
        <div className="agora-video-grid">
          <article className="agora-video-tile local"><div ref={localVideoElement} />{cameraOff && <VideoOff />}<span>{credentials?.name} {credentials?.isStaff ? "· Host" : "· You"}</span></article>
          {remoteUsers.map((user) => <RemoteVideo key={String(user.uid)} user={user} />)}
          {remoteUsers.length === 0 && <div className="agora-waiting"><Users /><strong>Waiting for others to join</strong><p>Only authorised accounts can enter this room.</p></div>}
        </div>
        <footer>
          <button disabled={!microphoneRef.current} className={microphoneOff ? "off" : ""} onClick={() => void toggleMicrophone()}>{microphoneOff ? <MicOff /> : <Mic />}<span>{microphoneOff ? "Unmute" : "Mute"}</span></button>
          <button disabled={!cameraRef.current} className={cameraOff ? "off" : ""} onClick={() => void toggleCamera()}>{cameraOff ? <VideoOff /> : <Video />}<span>{cameraOff ? "Start video" : "Stop video"}</span></button>
          <button className="leave" onClick={close}><PhoneOff /><span>Leave</span></button>
        </footer>
      </>}
    </section>
  </div>;
}
