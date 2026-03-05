"use client";

import { Fragment, useEffect, useState } from "react";

type JobRow = {
  id: string;
  status: string;
  templateName: string;
  dropboxSourceFilePath: string;
  outputDropboxPath: string | null;
  errorMessage: string | null;
  createdAt: string;
  sentToVeoAt: string | null;
  completedAt: string | null;
};

type JobDetails = {
  referenceImageUrls: string[];
  sourceImageUrl: string | null;
  outputVideoUrl: string | null;
};

const POLL_INTERVAL_MS = 5000;
const IN_PROGRESS_STATUSES = new Set(["queued", "processing", "sent_to_veo"]);

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: "Queued",
    processing: "Processing",
    completed: "Completed",
    failed: "Failed",
    sent_to_veo: "Processing", // legacy, migrated to processing
  };
  return labels[status] ?? status;
}

function statusColor(status: string): string {
  if (status === "completed")
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300";
  if (status === "failed")
    return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300";
  return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
}

function JobDetailsPanel({ job, details }: { job: JobRow; details?: JobDetails | null }) {
  const hasInputs = details && (details.referenceImageUrls.length > 0 || details.sourceImageUrl);
  const hasOutput = job.status === "completed" && details?.outputVideoUrl;

  return (
    <div className="space-y-4">
      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Paths
        </h4>
        <dl className="space-y-1 text-sm">
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Source file</dt>
            <dd className="break-all font-mono text-zinc-700 dark:text-zinc-300">{job.dropboxSourceFilePath}</dd>
          </div>
          {job.status === "completed" && job.outputDropboxPath && (
            <div>
              <dt className="text-zinc-500 dark:text-zinc-400">Output</dt>
              <dd className="break-all font-mono text-zinc-700 dark:text-zinc-300">{job.outputDropboxPath}</dd>
            </div>
          )}
          {job.status === "failed" && job.errorMessage && (
            <div>
              <dt className="text-zinc-500 dark:text-zinc-400">Error</dt>
              <dd className="break-all text-red-600 dark:text-red-400">{job.errorMessage}</dd>
            </div>
          )}
        </dl>
      </div>
      {!details && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading previews…</p>
      )}
      {details && hasInputs && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Input images
          </h4>
          <div className="flex flex-wrap gap-3">
            {details.referenceImageUrls.map((url, i) => (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="block overflow-hidden rounded-lg border border-zinc-200 shadow-sm dark:border-zinc-600"
              >
                <img
                  src={url}
                  alt={`Reference ${i + 1}`}
                  className="h-24 w-auto object-cover"
                />
              </a>
            ))}
            {details.sourceImageUrl && (
              <a
                href={details.sourceImageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block overflow-hidden rounded-lg border border-zinc-200 shadow-sm dark:border-zinc-600"
              >
                <img
                  src={details.sourceImageUrl}
                  alt="Source (new image)"
                  className="h-24 w-auto object-cover"
                />
              </a>
            )}
          </div>
          {details.referenceImageUrls.length > 0 && (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Ref 1, Ref 2 · Last: source image from Dropbox
            </p>
          )}
        </div>
      )}
      {hasOutput && details.outputVideoUrl && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Result video
          </h4>
          <div className="max-w-lg">
            <video
              src={details.outputVideoUrl}
              controls
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-600"
            >
              Your browser does not support the video tag.
            </video>
            <a
              href={details.outputVideoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-xs text-zinc-600 hover:underline dark:text-zinc-400"
            >
              Open in new tab
            </a>
          </div>
        </div>
      )}
      {details && !hasInputs && !hasOutput && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No previews available.</p>
      )}
    </div>
  );
}

export function JobsList() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailsCache, setDetailsCache] = useState<Record<string, JobDetails>>({});
  const [detailsLoading, setDetailsLoading] = useState<string | null>(null);

  async function fetchJobs() {
    try {
      const res = await fetch("/api/jobs");
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs ?? []);
      }
    } catch {
      // keep previous state
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchJobs();
  }, []);

  useEffect(() => {
    const hasInProgress = jobs.some((j) => IN_PROGRESS_STATUSES.has(j.status));
    if (!hasInProgress) return;
    const t = setInterval(fetchJobs, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [jobs]);

  async function processQueueNow() {
    setProcessing(true);
    try {
      const res = await fetch("/api/jobs/start-execution", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        await fetchJobs();
      }
    } finally {
      setProcessing(false);
    }
  }

  function toggleExpand(jobId: string) {
    if (expandedId === jobId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(jobId);
    if (detailsCache[jobId]) return;
    setDetailsLoading(jobId);
    fetch(`/api/jobs/${jobId}/details`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: JobDetails | null) => {
        if (data) setDetailsCache((c) => ({ ...c, [jobId]: data }));
      })
      .finally(() => setDetailsLoading(null));
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-zinc-600 dark:text-zinc-400">Loading jobs…</p>
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-zinc-600 dark:text-zinc-400">
          No jobs yet. Jobs are created when new images appear in a template’s
          Dropbox source folder.
        </p>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={processQueueNow}
            disabled={processing}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            {processing ? "Processing…" : "Process queue now"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50/80 dark:border-zinc-700 dark:bg-zinc-800/80">
              <th className="w-10 px-2 py-3" aria-label="Expand" />
              <th className="px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300">
                Template
              </th>
              <th className="px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300">
                Status
              </th>
              <th className="px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300">
                Created
              </th>
              <th className="px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300">
                Completed
              </th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <Fragment key={j.id}>
                <tr className="border-b border-zinc-100 dark:border-zinc-700/50">
                  <td className="px-2 py-3">
                    <button
                      type="button"
                      onClick={() => toggleExpand(j.id)}
                      className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                      aria-expanded={expandedId === j.id}
                      title={expandedId === j.id ? "Collapse" : "Expand details"}
                    >
                      <svg
                        className={`h-5 w-5 transition-transform ${expandedId === j.id ? "rotate-90" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </td>
                  <td className="px-4 py-3 text-zinc-900 dark:text-zinc-100">
                    {j.templateName}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor(j.status)}`}
                    >
                      {statusLabel(j.status)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-zinc-600 dark:text-zinc-400">
                    {formatDate(j.createdAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-zinc-600 dark:text-zinc-400">
                    {formatDate(j.completedAt)}
                  </td>
                </tr>
                {expandedId === j.id && (
                  <tr className="border-b border-zinc-100 bg-zinc-50/50 dark:border-zinc-700/50 dark:bg-zinc-800/30">
                    <td colSpan={5} className="px-4 py-4">
                      {detailsLoading === j.id ? (
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading details…</p>
                      ) : (
                        <JobDetailsPanel job={j} details={detailsCache[j.id]} />
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-zinc-200 px-4 py-2 dark:border-zinc-700">
        {jobs.some((j) => IN_PROGRESS_STATUSES.has(j.status)) ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Auto-refreshing every 5s while jobs are in progress.
          </p>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={processQueueNow}
          disabled={processing}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        >
          {processing ? "Processing…" : "Process queue now"}
        </button>
      </div>
    </div>
  );
}
