import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { PublicNav } from "./PublicNav";
import { PricingCalculator } from "./PricingCalculator";

export const metadata = {
  title: "Videitos – AI video generation from your images",
  description:
    "Create short videos from templates and images. Connect Dropbox, choose a model, and generate clips with Runway Gen-4 or Veo 3.1.",
};

export default async function HomePage() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-zinc-950">
      <PublicNav />

      <main>
        {/* Hero */}
        <section className="border-b border-zinc-200 bg-white px-4 py-16 dark:border-zinc-800 dark:bg-zinc-900/50 sm:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-5xl">
              AI video generation from your images
            </h1>
            <p className="mt-4 text-lg text-zinc-600 dark:text-zinc-400">
              Create short videos from templates and Dropbox folders. Choose
              Runway Gen-4 or Google Veo 3.1, set duration and options, and
              generate clips in minutes.
            </p>
            <div className="mt-8">
              <Link
                href="/login"
                className="inline-flex rounded-lg bg-zinc-900 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Log in to get started
              </Link>
            </div>
          </div>
        </section>

        {/* How it works — graphic flow */}
        <section className="px-4 py-16 sm:py-20">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-center text-2xl font-semibold text-zinc-900 dark:text-zinc-50 sm:text-3xl">
              How it works
            </h2>
            <p className="mt-2 text-center text-zinc-600 dark:text-zinc-400">
              Three steps from your folder to finished video
            </p>

            <div className="mt-12 grid gap-10 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:gap-4 sm:items-start lg:gap-8">
              {/* Step 1: Connect Dropbox */}
              <div className="flex flex-col items-center rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/80 sm:p-6">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950/50">
                  <svg
                    className="h-8 w-8 text-blue-600 dark:text-blue-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.25 12.75V12a2.25 2.25 0 012.25-2.25h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                    />
                  </svg>
                </div>
                <span className="mt-4 inline-flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900 text-xs font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
                  1
                </span>
                <h3 className="mt-3 text-base font-semibold text-zinc-900 dark:text-zinc-50">
                  Connect Dropbox
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  Link a folder. New images you add can trigger video generation
                  automatically.
                </p>
              </div>

              {/* Arrow 1 → 2 */}
              <div className="hidden items-center justify-center sm:flex" aria-hidden>
                <svg
                  className="h-6 w-6 shrink-0 text-zinc-400 dark:text-zinc-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </div>

              {/* Step 2: Create templates */}
              <div className="flex flex-col items-center rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/80 sm:p-6">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-violet-50 dark:bg-violet-950/50">
                  <svg
                    className="h-8 w-8 text-violet-600 dark:text-violet-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                </div>
                <span className="mt-4 inline-flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900 text-xs font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
                  2
                </span>
                <h3 className="mt-3 text-base font-semibold text-zinc-900 dark:text-zinc-50">
                  Create templates
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  Pick a model (Gen-4.5, Gen-4 Turbo, Veo 3.1 or Fast), set
                  duration, aspect ratio, and optional audio or pre-generation.
                </p>
              </div>

              {/* Arrow 2 → 3 */}
              <div className="hidden items-center justify-center sm:flex" aria-hidden>
                <svg
                  className="h-6 w-6 shrink-0 text-zinc-400 dark:text-zinc-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </div>

              {/* Step 3: Generate videos */}
              <div className="flex flex-col items-center rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/80 sm:p-6">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950/50">
                  <svg
                    className="h-8 w-8 text-emerald-600 dark:text-emerald-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z"
                    />
                  </svg>
                </div>
                <span className="mt-4 inline-flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900 text-xs font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
                  3
                </span>
                <h3 className="mt-3 text-base font-semibold text-zinc-900 dark:text-zinc-50">
                  Generate videos
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  Jobs run in the cloud; you pay per video in credits.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing + calculator */}
        <section className="border-t border-zinc-200 bg-white px-4 py-16 dark:border-zinc-800 dark:bg-zinc-900/50 sm:py-20">
          <div className="mx-auto max-w-4xl">
            <h2 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
              Pricing
            </h2>
            <p className="mt-2 text-zinc-600 dark:text-zinc-400">
              Pay in credits per video. Cost depends on model, duration, and
              options (e.g. audio, pre-generation). 100 credits = $1. Buy
              credits in the dashboard after signing in.
            </p>
            <div className="mt-8">
              <PricingCalculator />
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-zinc-200 px-4 py-8 dark:border-zinc-800">
          <div className="mx-auto flex max-w-6xl items-center justify-between">
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              © Videitos
            </span>
            <Link
              href="/privacy"
              className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Privacy policy
            </Link>
          </div>
        </footer>
      </main>
    </div>
  );
}
