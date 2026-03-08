import Link from "next/link";

export function PublicNav() {
  return (
    <nav className="border-b border-zinc-200 bg-white/80 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link
          href="/"
          className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
        >
          Videitos
        </Link>
        <div className="flex items-center gap-4">
          <Link
            href="/privacy"
            className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Privacy policy
          </Link>
          <Link
            href="/login"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Log in
          </Link>
        </div>
      </div>
    </nav>
  );
}
