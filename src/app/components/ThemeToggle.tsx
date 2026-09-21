"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "trailcast-theme";

function systemTheme(): Theme {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function activeTheme(): Theme {
  const explicit = document.documentElement.getAttribute("data-theme");
  return explicit === "dark" || explicit === "light" ? explicit : systemTheme();
}

/**
 * Light/dark switch.
 *
 * With no stored choice the page follows the system setting, so most people
 * never need this. A click records an explicit choice, which then wins over
 * the system. The stored value is a per-browser convenience only: if storage
 * is blocked (private windows, strict settings) the toggle still works for
 * the session and simply is not remembered.
 *
 * The first paint is handled by a tiny inline script in the layout, so a
 * dark-mode user never sees a flash of the light theme before this mounts.
 */
export default function ThemeToggle() {
  // Unknown until mounted: the server cannot know the viewer's preference,
  // and rendering a guess would mismatch on hydration.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(activeTheme());

    // Follow the system while the user has not made an explicit choice.
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (!document.documentElement.hasAttribute("data-theme")) setTheme(systemTheme());
    };
    media?.addEventListener?.("change", onChange);
    return () => media?.removeEventListener?.("change", onChange);
  }, []);

  function toggle() {
    const next: Theme = activeTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage unavailable: the choice still applies for this visit.
    }
    setTheme(next);
  }

  const label =
    theme === "dark" ? "Switch to light mode" : theme === "light" ? "Switch to dark mode" : "Toggle theme";

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      <span aria-hidden>{theme === "dark" ? "☀" : "☾"}</span>
    </button>
  );
}
