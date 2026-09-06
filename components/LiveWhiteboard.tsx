"use client";

import { Eraser, Highlighter, Pencil, Presentation, Trash2, Undo2, Users, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "../lib/supabase/client";
import {
  applyEvent,
  emptyScene,
  normaliseEvent,
  normaliseScene,
  WHITEBOARD_COLORS,
  WHITEBOARD_SIZES,
  type WhiteboardScene,
  type WhiteboardStroke,
  type WhiteboardTool
} from "../lib/live/whiteboard";

type AccessResponse = {
  channel: string;
  isHost: boolean;
  studentsMayDraw: boolean;
  canDraw: boolean;
  scene: WhiteboardScene;
};

type RealtimeChannel = ReturnType<NonNullable<ReturnType<typeof getSupabaseBrowserClient>>["channel"]>;

const SYNC_REPLY_INTERVAL = 2000;
const SAVE_DEBOUNCE = 4000;
const MIN_POINT_GAP = 0.004; // normalised distance before a new point is recorded

async function authHeaders() {
  const supabase = getSupabaseBrowserClient();
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : null;
}

function strokeStyle(ctx: CanvasRenderingContext2D, stroke: WhiteboardStroke, width: number, height: number) {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (stroke.tool === "eraser") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(0,0,0,1)";
    ctx.lineWidth = stroke.size * 3.5;
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = stroke.tool === "marker" ? 0.32 : 1;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.tool === "marker" ? stroke.size * 2.4 : stroke.size;
  }
  const scaleX = width;
  const scaleY = height;
  ctx.beginPath();
  stroke.points.forEach((point, index) => {
    const x = point[0] * scaleX;
    const y = point[1] * scaleY;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  if (stroke.points.length === 1) {
    const only = stroke.points[0];
    ctx.lineTo(only[0] * scaleX + 0.01, only[1] * scaleY + 0.01);
  }
  ctx.stroke();
}

export default function LiveWhiteboard({ lessonId }: { lessonId: string }) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [studentsMayDraw, setStudentsMayDraw] = useState(false);
  const [canDraw, setCanDraw] = useState(false);
  const [tool, setTool] = useState<WhiteboardTool>("pen");
  const [color, setColor] = useState<string>(WHITEBOARD_COLORS[0]);
  const [size, setSize] = useState<number>(WHITEBOARD_SIZES[1]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const sceneRef = useRef<WhiteboardScene>(emptyScene());
  const authorRef = useRef<string>(typeof crypto !== "undefined" ? crypto.randomUUID() : `a-${Math.random()}`);
  const activeStrokeRef = useRef<WhiteboardStroke | null>(null);
  const lastSyncReplyRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHostRef = useRef(false);
  const canDrawRef = useRef(false);

  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);
  useEffect(() => {
    canDrawRef.current = canDraw;
  }, [canDraw]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const surface = surfaceRef.current;
    if (!canvas || !surface) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssWidth = surface.clientWidth;
    const cssHeight = surface.clientHeight;
    if (canvas.width !== Math.round(cssWidth * dpr) || canvas.height !== Math.round(cssHeight * dpr)) {
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    for (const stroke of sceneRef.current.strokes) strokeStyle(ctx, stroke, cssWidth, cssHeight);
    if (activeStrokeRef.current) strokeStyle(ctx, activeStrokeRef.current, cssWidth, cssHeight);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }, []);

  const setScene = useCallback(
    (next: WhiteboardScene) => {
      sceneRef.current = next;
      redraw();
    },
    [redraw]
  );

  const flushSave = useCallback(async () => {
    if (!isHostRef.current) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const headers = await authHeaders();
    if (!headers) return;
    try {
      await fetch("/api/live-sessions/whiteboard", {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId, scene: sceneRef.current }),
        keepalive: true
      });
    } catch {
      // A dropped snapshot is recovered by the next edit or by peer sync.
    }
  }, [lessonId]);

  const scheduleSave = useCallback(() => {
    if (!isHostRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void flushSave();
    }, SAVE_DEBOUNCE);
  }, [flushSave]);

  const broadcast = useCallback((payload: Record<string, unknown>) => {
    const pending = channelRef.current?.send({ type: "broadcast", event: "wb", payload });
    if (pending && typeof pending.then === "function") pending.catch(() => {});
  }, []);

  const handleRemote = useCallback(
    (payload: unknown) => {
      if (!payload || typeof payload !== "object") return;
      const message = payload as Record<string, unknown>;

      if (message.type === "perms") {
        const enabled = Boolean(message.studentsMayDraw);
        setStudentsMayDraw(enabled);
        if (!isHostRef.current) setCanDraw(enabled);
        return;
      }
      if (message.type === "sync-request") {
        if (!isHostRef.current) return;
        const now = Date.now();
        if (now - lastSyncReplyRef.current < SYNC_REPLY_INTERVAL) return;
        lastSyncReplyRef.current = now;
        broadcast({ type: "sync", scene: sceneRef.current });
        return;
      }
      if (message.type === "sync") {
        if (isHostRef.current) return;
        const incoming = normaliseScene(message.scene);
        if (incoming.strokes.length >= sceneRef.current.strokes.length) setScene(incoming);
        return;
      }

      const event = normaliseEvent(message);
      if (event) setScene(applyEvent(sceneRef.current, event));
    },
    [broadcast, setScene]
  );

  // Load access + current scene, then join the realtime channel.
  useEffect(() => {
    if (!supabase) {
      setFailed(true);
      return;
    }
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    (async () => {
      const headers = await authHeaders();
      if (!headers) {
        if (!cancelled) setFailed(true);
        return;
      }
      let access: AccessResponse;
      try {
        const response = await fetch(`/api/live-sessions/whiteboard?lessonId=${encodeURIComponent(lessonId)}`, {
          headers,
          cache: "no-store"
        });
        if (!response.ok) throw new Error(String(response.status));
        access = (await response.json()) as AccessResponse;
      } catch {
        if (!cancelled) setFailed(true);
        return;
      }
      if (cancelled) return;

      setIsHost(access.isHost);
      isHostRef.current = access.isHost;
      setStudentsMayDraw(access.studentsMayDraw);
      setCanDraw(access.canDraw);
      canDrawRef.current = access.canDraw;
      sceneRef.current = normaliseScene(access.scene);
      setReady(true);

      channel = supabase.channel(access.channel, {
        config: { broadcast: { self: false, ack: false } }
      });
      channelRef.current = channel;
      channel
        .on("broadcast", { event: "wb" }, ({ payload }) => handleRemote(payload))
        .subscribe((status) => {
          if (status === "SUBSCRIBED") broadcast({ type: "sync-request" });
        });
    })();

    return () => {
      cancelled = true;
      void flushSave();
      if (channel) supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [supabase, lessonId, handleRemote, broadcast, flushSave]);

  // Redraw when the surface opens or resizes.
  useEffect(() => {
    if (!open) return;
    redraw();
    const surface = surfaceRef.current;
    if (!surface || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => redraw());
    observer.observe(surface);
    return () => observer.disconnect();
  }, [open, redraw]);

  // Persist a final snapshot if the tab is hidden mid-session.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flushSave();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [flushSave]);

  const pointFromEvent = useCallback((event: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const surface = surfaceRef.current;
    if (!surface) return [0, 0];
    const rect = surface.getBoundingClientRect();
    const x = (event.clientX - rect.left) / Math.max(rect.width, 1);
    const y = (event.clientY - rect.top) / Math.max(rect.height, 1);
    return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!canDrawRef.current) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      activeStrokeRef.current = {
        id: authorRef.current.slice(0, 8) + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        author: authorRef.current,
        tool,
        color,
        size,
        points: [pointFromEvent(event)]
      };
      redraw();
    },
    [tool, color, size, pointFromEvent, redraw]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const stroke = activeStrokeRef.current;
      if (!stroke) return;
      const next = pointFromEvent(event);
      const last = stroke.points[stroke.points.length - 1];
      if (Math.hypot(next[0] - last[0], next[1] - last[1]) < MIN_POINT_GAP) return;
      stroke.points.push(next);
      redraw();
    },
    [pointFromEvent, redraw]
  );

  const finishStroke = useCallback(() => {
    const stroke = activeStrokeRef.current;
    activeStrokeRef.current = null;
    if (!stroke) return;
    if (stroke.points.length < 1) {
      redraw();
      return;
    }
    setScene(applyEvent(sceneRef.current, { type: "stroke", stroke }));
    broadcast({ type: "stroke", stroke });
    scheduleSave();
  }, [broadcast, scheduleSave, setScene]);

  const undo = useCallback(() => {
    const mine = [...sceneRef.current.strokes].reverse().find((stroke) => stroke.author === authorRef.current);
    if (!mine) return;
    setScene(applyEvent(sceneRef.current, { type: "remove", ids: [mine.id] }));
    broadcast({ type: "remove", ids: [mine.id] });
    scheduleSave();
  }, [broadcast, scheduleSave, setScene]);

  const clearBoard = useCallback(() => {
    if (!isHostRef.current) return;
    setScene({ strokes: [] });
    broadcast({ type: "clear" });
    scheduleSave();
  }, [broadcast, scheduleSave, setScene]);

  const toggleStudentDrawing = useCallback(async () => {
    if (!isHostRef.current) return;
    const next = !studentsMayDraw;
    setStudentsMayDraw(next);
    broadcast({ type: "perms", studentsMayDraw: next });
    const headers = await authHeaders();
    if (!headers) return;
    try {
      await fetch("/api/live-sessions/whiteboard", {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId, studentsMayDraw: next })
      });
    } catch {
      // The broadcast already updated every connected peer; the flag re-saves on the next host edit.
    }
  }, [studentsMayDraw, broadcast, lessonId]);

  if (failed || !supabase || !ready) return null;

  return (
    <>
      {!open && (
        <button type="button" className="live-wb-launch" onClick={() => setOpen(true)}>
          <Presentation aria-hidden />
          <span>Whiteboard</span>
        </button>
      )}
      {open && (
        <div className="live-wb" role="dialog" aria-modal="true" aria-label="Live whiteboard">
          <div className="live-wb-bar">
            <div className="live-wb-tools">
              <button
                type="button"
                className={tool === "pen" ? "on" : ""}
                onClick={() => setTool("pen")}
                aria-label="Pen"
                disabled={!canDraw}
              >
                <Pencil aria-hidden />
              </button>
              <button
                type="button"
                className={tool === "marker" ? "on" : ""}
                onClick={() => setTool("marker")}
                aria-label="Highlighter"
                disabled={!canDraw}
              >
                <Highlighter aria-hidden />
              </button>
              <button
                type="button"
                className={tool === "eraser" ? "on" : ""}
                onClick={() => setTool("eraser")}
                aria-label="Eraser"
                disabled={!canDraw}
              >
                <Eraser aria-hidden />
              </button>
              <span className="live-wb-sep" />
              {WHITEBOARD_COLORS.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  className={"live-wb-swatch" + (color === swatch && tool !== "eraser" ? " on" : "")}
                  style={{ background: swatch }}
                  onClick={() => {
                    setColor(swatch);
                    if (tool === "eraser") setTool("pen");
                  }}
                  aria-label={`Colour ${swatch}`}
                  disabled={!canDraw}
                />
              ))}
              <span className="live-wb-sep" />
              {WHITEBOARD_SIZES.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={"live-wb-size" + (size === option ? " on" : "")}
                  onClick={() => setSize(option)}
                  aria-label={`Brush size ${option}`}
                  disabled={!canDraw}
                >
                  <i style={{ width: option + 4, height: option + 4 }} />
                </button>
              ))}
            </div>
            <div className="live-wb-actions">
              <button type="button" onClick={undo} aria-label="Undo my last stroke" disabled={!canDraw}>
                <Undo2 aria-hidden />
              </button>
              {isHost && (
                <>
                  <button type="button" onClick={clearBoard} aria-label="Clear the board">
                    <Trash2 aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={"live-wb-perm" + (studentsMayDraw ? " on" : "")}
                    onClick={() => void toggleStudentDrawing()}
                    aria-pressed={studentsMayDraw}
                  >
                    <Users aria-hidden />
                    <span>{studentsMayDraw ? "Students can draw" : "Students view only"}</span>
                  </button>
                </>
              )}
              <button type="button" className="live-wb-hide" onClick={() => setOpen(false)}>
                <X aria-hidden />
                <span>Hide</span>
              </button>
            </div>
          </div>
          <div className="live-wb-surface" ref={surfaceRef}>
            <canvas
              ref={canvasRef}
              className="live-wb-canvas"
              style={{ cursor: canDraw ? "crosshair" : "default", touchAction: "none" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={finishStroke}
              onPointerCancel={finishStroke}
              onPointerLeave={finishStroke}
            />
            {!canDraw && <p className="live-wb-readonly">View only — the host controls the board</p>}
          </div>
        </div>
      )}
    </>
  );
}
