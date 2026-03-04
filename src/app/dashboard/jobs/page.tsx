import { JobsList } from "./JobsList";

export default function JobsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Jobs
      </h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Video generation jobs from your templates. New jobs are created when
        images are added to a template’s Dropbox source folder.
      </p>
      <JobsList />
    </div>
  );
}
