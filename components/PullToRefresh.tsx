"use client";

import { LoaderCircle, ArrowDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Nearly every view in this app is a `position:fixed; overflow:auto` pane, so the
// document itself never scrolls and the browser never fires its native
// pull-to-refresh. This restores the gesture by driving it ourselves against
// whichever pane the finger actually started in.

const TRIGGER_DISTANCE = 72;
const MAX_PULL = 108;
const RESISTANCE = 0.52;

function scrollParentOf(start: EventTarget | null) {
  let node = start instanceof Element ? start : null;
  while (node && node !== document.body && node !== document.documentElement) {
    const style = getComputedStyle(node);
    const scrollable = /(auto|scroll|overlay)/.test(style.overflowY);
    if (scrollable && node.scrollHeight > node.clientHeight + 1) return node;
    node = node.parentElement;
  }
  return document.scrollingElement ?? document.documentElement;
}

export default function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const state = useRef({ startY: 0, startX: 0, tracking: false, engaged: false, distance: 0 });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(pointer: coarse)").matches) return;

    const reset = () => {
      state.current.tracking = false;
      state.current.engaged = false;
      state.current.distance = 0;
      setPull(0);
    };

    const onStart = (event: TouchEvent) => {
      if (refreshing || event.touches.length !== 1) return reset();
      const target = event.target as Element | null;
      // Zoom renders its own full-screen meeting UI; never hijack gestures there.
      if (target?.closest("#zmmtg-root, [data-no-pull-refresh]")) return;
      const container = scrollParentOf(target);
      if (container.scrollTop > 0) return;
      state.current.startY = event.touches[0].clientY;
      state.current.startX = event.touches[0].clientX;
      state.current.tracking = true;
      state.current.engaged = false;
      state.current.distance = 0;
    };

    const onMove = (event: TouchEvent) => {
      if (!state.current.tracking || refreshing) return;
      const dy = event.touches[0].clientY - state.current.startY;
      const dx = event.touches[0].clientX - state.current.startX;
      if (!state.current.engaged) {
        // Let horizontal swipes and any upward scroll behave normally.
        if (dy <= 6 || Math.abs(dx) > Math.abs(dy)) {
          if (Math.abs(dx) > 8 || dy < -6) state.current.tracking = false;
          return;
        }
        state.current.engaged = true;
      }
      if (dy <= 0) {
        state.current.engaged = false;
        state.current.distance = 0;
        setPull(0);
        return;
      }
      if (event.cancelable) event.preventDefault();
      const distance = Math.min(MAX_PULL, dy * RESISTANCE);
      state.current.distance = distance;
      setPull(distance);
    };

    const onEnd = () => {
      if (!state.current.tracking) return;
      const shouldRefresh = state.current.engaged && state.current.distance >= TRIGGER_DISTANCE;
      reset();
      if (!shouldRefresh) return;
      setRefreshing(true);
      setPull(TRIGGER_DISTANCE);
      window.location.reload();
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", reset, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", reset);
    };
  }, [refreshing]);

  if (pull <= 0 && !refreshing) return null;

  const ready = refreshing || pull >= TRIGGER_DISTANCE;

  return (
    <div className="pull-refresh-indicator" aria-hidden style={{ transform: `translate(-50%, ${pull}px)`, opacity: Math.min(1, pull / 34) }}>
      <span className={[ready ? "ready" : "", refreshing ? "spinning" : ""].filter(Boolean).join(" ") || undefined} style={{ transform: refreshing ? undefined : `rotate(${Math.min(180, (pull / TRIGGER_DISTANCE) * 180)}deg)` }}>
        {refreshing ? <LoaderCircle /> : <ArrowDown />}
      </span>
    </div>
  );
}
