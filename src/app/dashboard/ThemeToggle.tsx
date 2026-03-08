"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "videitos-theme";

export function useTheme() {
  const [theme, setThemeState] = useState<"light" | "dark">("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem(STORAGE_KEY) as "light" | "dark" | null;
    const hasDark = document.documentElement.classList.contains("dark");
    setThemeState(stored ?? (hasDark ? "dark" : "light"));
  }, []);

  function setTheme(next: "light" | "dark") {
    setThemeState(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    localStorage.setItem(STORAGE_KEY, next);
  }

  function toggle() {
    setTheme(theme === "dark" ? "light" : "dark");
  }

  return { theme, setTheme, toggle, mounted };
}

export function ThemeToggle() {
  const { theme, toggle, mounted } = useTheme();

  if (!mounted) {
    return (
      <span className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500" aria-hidden>
        <span className="h-5 w-5" />
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}
