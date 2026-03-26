import { JobsList } from "./jobs/JobsList";
import { getSessionUser } from "@/lib/auth";
import { USER_ROLE } from "@/lib/constants/user-role";

export default async function DashboardHomePage() {
  const user = await getSessionUser();
  const isAdmin = user?.role === USER_ROLE.ADMIN;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Jobs
      </h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        {isAdmin
          ? "Video generation jobs across users. New jobs are created when images are added to template Dropbox source folders."
          : "Video generation jobs from your templates. New jobs are created when images are added to a template’s Dropbox source folder."}
      </p>
      <JobsList isAdmin={isAdmin} />
    </div>
  );
}
