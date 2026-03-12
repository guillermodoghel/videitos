import { redirect } from "next/navigation";
import { USER_ROLE } from "@/lib/constants/user-role";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user || user.role !== USER_ROLE.ADMIN) {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/dashboard/admin/users"
          className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Users
        </Link>
        <Link
          href="/dashboard/admin/revenue"
          className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Revenue
        </Link>
      </div>
      {children}
    </div>
  );
}
