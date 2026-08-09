"use client";

import { useEffect, useRef } from "react";

export default function ContentProtection({
  watermark,
  strict = false,
  active = true,
  onViolation
}: {
  watermark: string;
  strict?: boolean;
  active?: boolean;
  onViolation?: (reason: string) => void;
}) {
  const violationHandler = useRef(onViolation);

  useEffect(() => {
    violationHandler.current = onViolation;
  }, [onViolation]);

  useEffect(() => {
    if (!active) return;

    const prevent = (event: Event) => event.preventDefault();
    const preventProtectedShortcut = (event: KeyboardEvent) => {
      const protectedShortcut = (event.ctrlKey || event.metaKey)
        && ["c", "p", "s", "u"].includes(event.key.toLowerCase());
      if (event.key === "PrintScreen" || protectedShortcut) event.preventDefault();
    };

    document.addEventListener("contextmenu", prevent);
    document.addEventListener("copy", prevent);
    document.addEventListener("cut", prevent);
    document.addEventListener("dragstart", prevent);
    document.addEventListener("keydown", preventProtectedShortcut);
    return () => {
      document.removeEventListener("contextmenu", prevent);
      document.removeEventListener("copy", prevent);
      document.removeEventListener("cut", prevent);
      document.removeEventListener("dragstart", prevent);
      document.removeEventListener("keydown", preventProtectedShortcut);
    };
  }, [active]);

  useEffect(() => {
    if (!active || !strict) return;

    const report = (reason: string) => {
      violationHandler.current?.(reason);
    };
    const onVisibilityChange = () => {
      if (document.hidden) report("the test tab was changed or hidden");
    };
    const onBlur = () => window.setTimeout(() => {
      if (!document.hasFocus()) report("the test window lost focus");
    }, 150);
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) report("fullscreen mode was exited");
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      report("the test page was closed or left");
      event.preventDefault();
      event.returnValue = "";
    };
    const onPageHide = () => report("the test page was closed or left");

    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    window.addEventListener("blur", onBlur);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [active, strict]);

  return <div className="content-protection-watermark" aria-hidden="true">
    {Array.from({ length: 12 }, (_, index) => <span key={index}>ADCI PROTECTED · {watermark}</span>)}
  </div>;
}
