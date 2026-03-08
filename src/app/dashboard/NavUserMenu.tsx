"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "./ThemeToggle";

const CREDITS_POLL_MS = 5000;

function formatCredits(balance: number): string {
  return balance.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function NavUserMenu({
  email,
  creditBalance = 0,
}: {
  email: string;
  creditBalance?: number;
}) {
  const [open, setOpen] = useState(false);
  const [balance, setBalance] = useState(creditBalance);
  const menuRef = useRef<HTMLDivElement>(null);
  const { theme, setTheme, mounted } = useTheme();

  useEffect(() => {
    setBalance(creditBalance);
  }, [creditBalance]);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/credits", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          if (typeof data.balance === "number") setBalance(data.balance);
        }
      } catch {
        // keep previous balance
      }
    }, CREDITS_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50/80 px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-100 hover:border-zinc-300 dark:border-zinc-600 dark:bg-zinc-800/80 dark:hover:bg-zinc-700 dark:hover:border-zinc-500"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Account menu"
      >
        <span className="truncate max-w-[160px] sm:max-w-[220px] text-zinc-700 dark:text-zinc-300">
          {email}
        </span>
        <span className="shrink-0 tabular-nums text-zinc-500 dark:text-zinc-400">
          {formatCredits(balance)} credits
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform dark:text-zinc-500 ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-1.5 min-w-[180px] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-600 dark:bg-zinc-800 dark:shadow-xl"
          role="menu"
        >
          {mounted && (
            <>
              <div className="border-b border-zinc-100 px-3 py-2 dark:border-zinc-600">
                <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Theme</p>
                <div className="mt-1 flex gap-1">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setTheme("light");
                    }}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                      theme === "light"
                        ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-600 dark:text-zinc-100"
                        : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-700"
                    }`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <circle cx="12" cy="12" r="4" />
                      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                    </svg>
                    Light
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setTheme("dark");
                    }}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                      theme === "dark"
                        ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-600 dark:text-zinc-100"
                        : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-700"
                    }`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                    </svg>
                    Dark
                  </button>
                </div>
              </div>
            </>
          )}
          <form action="/api/auth/logout" method="POST" className="py-1">
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Log out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
