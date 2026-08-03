"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  window.localStorage.setItem("adci-theme", theme);
  window.dispatchEvent(new CustomEvent("adci-theme-change", { detail: theme }));
}

export default function ThemeToggle({ labelled = false, className = "" }: {
  labelled?: boolean;
  className?: string;
}) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const sync = () => setTheme(currentTheme());
    sync();
    window.addEventListener("adci-theme-change", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("adci-theme-change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const dark = theme === "dark";
  const label = dark ? "Switch to light mode" : "Switch to dark mode";

  return <button
    type="button"
    className={`theme-toggle ${labelled ? "labelled" : ""} ${className}`.trim()}
    aria-label={label}
    aria-pressed={dark}
    title={label}
    onClick={() => {
      const next = dark ? "light" : "dark";
      applyTheme(next);
      setTheme(next);
    }}
  >
    <span className="theme-toggle-track"><Sun /><Moon /><i /></span>
    {labelled && <span><strong>{dark ? "Dark mode" : "Light mode"}</strong><small>{dark ? "Comfortable viewing in low light" : "Bright appearance for daytime"}</small></span>}
  </button>;
}
