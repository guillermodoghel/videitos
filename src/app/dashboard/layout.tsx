import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { NavUserMenu } from "./NavUserMenu";
import { USER_ROLE } from "@/lib/constants/user-role";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/");

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:border-zinc-800 dark:bg-zinc-900/95 dark:supports-[backdrop-filter]:dark:bg-zinc-900/80">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between gap-4 px-4">
          <nav className="flex items-center gap-1">
            <Link
              href="/dashboard"
              className="rounded-md px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              Jobs
            </Link>
            <Link
              href="/dashboard/templates"
              className="rounded-md px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              Templates
            </Link>
            <Link
              href="/dashboard/credits"
              className="rounded-md px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              Credits
            </Link>
            <Link
              href="/dashboard/pricing"
              className="rounded-md px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              Pricing
            </Link>
            <Link
              href="/dashboard/settings"
              className="rounded-md px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              Settings
            </Link>
            {user.role === USER_ROLE.ADMIN && (
              <Link
                href="/dashboard/admin/users"
                className="rounded-md px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                Admin
              </Link>
            )}
          </nav>
          <NavUserMenu
            email={user.email}
            creditBalance={user.creditBalance}
          />
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
    </div>
  );
}
