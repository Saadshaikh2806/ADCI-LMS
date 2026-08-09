"use client";

import { useEffect, useRef, useState } from "react";

export default function ContentProtection({
  watermark,
  strict = false,
  active = true,
  concealWhenInactive = false,
  onViolation
}: {
  watermark: string;
  strict?: boolean;
  active?: boolean;
  concealWhenInactive?: boolean;
  onViolation?: (reason: string) => void;
}) {
  const violationHandler = useRef(onViolation);
  const watermarkLayer = useRef<HTMLDivElement>(null);
  const shield = useRef<HTMLDivElement>(null);
  const [timestamp, setTimestamp] = useState("");

  useEffect(() => {
    violationHandler.current = onViolation;
  }, [onViolation]);

  useEffect(() => {
    if (!active) return;
    const updateTimestamp = () => setTimestamp(new Date().toLocaleString("en-IN", { hour12: false }));
    updateTimestamp();
    const timer = window.setInterval(updateTimestamp, 15_000);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (!active) return;

    const prevent = (event: Event) => event.preventDefault();
    let screenshotTimer = 0;
    const preventProtectedShortcut = (event: KeyboardEvent) => {
      const protectedShortcut = (event.ctrlKey || event.metaKey)
        && ["c", "p", "s", "u"].includes(event.key.toLowerCase());
      if (event.key === "PrintScreen") {
        event.preventDefault();
        watermarkLayer.current?.classList.add("visible");
        shield.current?.classList.add("visible");
        window.clearTimeout(screenshotTimer);
        screenshotTimer = window.setTimeout(() => {
          if (!concealWhenInactive || (!document.hidden && document.hasFocus())) {
            watermarkLayer.current?.classList.remove("visible");
            shield.current?.classList.remove("visible");
          }
        }, 2_000);
      } else if (protectedShortcut) event.preventDefault();
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
      window.clearTimeout(screenshotTimer);
    };
  }, [active, concealWhenInactive]);

  useEffect(() => {
    if (!active || !concealWhenInactive) return;
    const conceal = () => {
      watermarkLayer.current?.classList.add("visible");
      shield.current?.classList.add("visible");
    };
    const reveal = () => {
      if (!document.hidden && document.hasFocus()) {
        watermarkLayer.current?.classList.remove("visible");
        shield.current?.classList.remove("visible");
      }
    };
    const updateVisibility = () => document.hidden ? conceal() : reveal();

    document.addEventListener("visibilitychange", updateVisibility);
    window.addEventListener("blur", conceal);
    window.addEventListener("focus", reveal);
    updateVisibility();
    return () => {
      document.removeEventListener("visibilitychange", updateVisibility);
      window.removeEventListener("blur", conceal);
      window.removeEventListener("focus", reveal);
    };
  }, [active, concealWhenInactive]);

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

  const label = `ADCI PROTECTED · ${watermark}${timestamp ? ` · ${timestamp}` : ""}`;
  return <>
    <div ref={watermarkLayer} className="content-protection-watermark" aria-hidden="true">
      {Array.from({ length: 16 }, (_, index) => <span key={index}>{label}</span>)}
    </div>
    <div ref={shield} className="content-protection-shield" aria-hidden="true">
      <span>Protected content hidden<small>Return to this window to continue.</small></span>
    </div>
  </>;
}
