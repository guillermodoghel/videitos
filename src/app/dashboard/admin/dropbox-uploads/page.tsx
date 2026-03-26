import { prisma } from "@/lib/prisma";
import { JOB_STATUS } from "@/lib/constants/job-status";
import { JOB_ERROR } from "@/lib/constants/job-error-messages";
import { RetryDropboxUploadButton } from "./RetryDropboxUploadButton";

function formatDate(d: Date): string {
  return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

export default async function AdminDropboxUploadsPage() {
  const failures = await prisma.job.findMany({
    where: {
      status: JOB_STATUS.FAILED,
      errorMessage: JOB_ERROR.DROPBOX_UPLOAD_FAILED,
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: {
      user: { select: { email: true } },
      template: { select: { name: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Dropbox upload failures
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Failed jobs where upload to Dropbox returned an error. Limit: latest 200.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-700">
          <thead>
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Updated</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">User</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Template</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Source</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
            {failures.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  No Dropbox upload failures.
                </td>
              </tr>
            ) : (
              failures.map((job) => (
                <tr key={job.id} className="text-sm">
                  <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">{formatDate(job.updatedAt)}</td>
                  <td className="px-4 py-3 text-zinc-900 dark:text-zinc-100">{job.user.email}</td>
                  <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">{job.template.name}</td>
                  <td className="max-w-md break-all px-4 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-400">{job.dropboxSourceFilePath}</td>
                  <td className="px-4 py-3 text-right">
                    <RetryDropboxUploadButton jobId={job.id} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
