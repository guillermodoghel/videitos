"use client";

import { Fragment, useEffect, useState } from "react";
import { VIDEO_MODELS } from "@/lib/video-models";
import { JOB_STATUS } from "@/lib/constants/job-status";

type JobRow = {
  id: string;
  status: string;
  templateName: string;
  model: string;
  dropboxSourceFilePath: string;
  outputDropboxPath: string | null;
  preGenImageKey: string | null;
  errorMessage: string | null;
  apiCost: number | null;
  creditCost: number | null;
  createdAt: string;
  sentAt: string | null;
  completedAt: string | null;
};

type JobDetails = {
  referenceImageUrls: string[];
  sourceImageUrl: string | null;
  preGenImageUrl: string | null;
  outputVideoUrl: string | null;
};

const POLL_INTERVAL_MS = 5000;
const DEFAULT_PER_PAGE = 10;
const PER_PAGE_OPTIONS = [10, 20, 50, 100];

function formatDuration(createdAt: string, completedAt: string | null): string {
  if (!completedAt) return "—";
  const start = new Date(createdAt).getTime();
  const end = new Date(completedAt).getTime();
  const secs = Math.round((end - start) / 1000);
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    [JOB_STATUS.QUEUED]: "Queued",
    [JOB_STATUS.PROCESSING]: "Processing",
    [JOB_STATUS.COMPLETED]: "Completed",
    [JOB_STATUS.FAILED]: "Failed",
    [JOB_STATUS.SENT_TO_VEO]: "Processing", // legacy
  };
  return labels[status] ?? status;
}

function statusColor(status: string): string {
  if (status === JOB_STATUS.COMPLETED)
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300";
  if (status === JOB_STATUS.FAILED)
    return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300";
  return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
}

function StatusSpinner() {
  return (
    <svg
      className="h-3.5 w-3.5 shrink-0 animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function modelLabel(modelId: string): string {
  const m = VIDEO_MODELS.find((x) => x.id === modelId);
  return m?.name ?? modelId;
}

function JobDetailsPanel({ job, details }: { job: JobRow; details?: JobDetails | null }) {
  const hasInputs = details && (details.referenceImageUrls.length > 0 || details.sourceImageUrl);
  const hasPreGen = details?.preGenImageUrl;
  const hasOutput = job.status === JOB_STATUS.COMPLETED && details?.outputVideoUrl;

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
          {job.status === JOB_STATUS.COMPLETED && job.outputDropboxPath && (
            <div>
              <dt className="text-zinc-500 dark:text-zinc-400">Output</dt>
              <dd className="break-all font-mono text-zinc-700 dark:text-zinc-300">{job.outputDropboxPath}</dd>
            </div>
          )}
          {job.status === JOB_STATUS.FAILED && job.errorMessage && (
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
      {hasPreGen && details.preGenImageUrl && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Generated image (pre-gen)
          </h4>
          <a
            href={details.preGenImageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block max-w-sm overflow-hidden rounded-lg border border-zinc-200 shadow-sm dark:border-zinc-600"
          >
            <img
              src={details.preGenImageUrl}
              alt="Pre-generation output"
              className="h-auto w-full object-contain"
            />
          </a>
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
      {details && !hasInputs && !hasPreGen && !hasOutput && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No previews available.</p>
      )}
    </div>
  );
}

export function JobsList() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [total, setTotal] = useState(0);
  const [hasActiveJobs, setHasActiveJobs] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_PER_PAGE);
  const [filterModel, setFilterModel] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [pollingEnabled, setPollingEnabled] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailsCache, setDetailsCache] = useState<Record<string, JobDetails>>({});
  const [detailsLoading, setDetailsLoading] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const start = total === 0 ? 0 : (page - 1) * perPage + 1;
  const end = Math.min(page * perPage, total);

  useEffect(() => {
    if (totalPages > 0 && page > totalPages) setPage(totalPages);
  }, [totalPages, page]);

  async function fetchJobs() {
    try {
      const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
      if (filterModel) params.set("model", filterModel);
      if (filterStatus) params.set("status", filterStatus);
      const res = await fetch(`/api/jobs?${params}`);
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs ?? []);
        setTotal(data.total ?? 0);
        setHasActiveJobs(data.hasActiveJobs === true);
      }
    } catch {
      // keep previous state
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchJobs();
  }, [page, perPage, filterModel, filterStatus]);

  // Poll only when user wants it and backend says there are active jobs (queued/processing)
  useEffect(() => {
    if (!pollingEnabled || !hasActiveJobs) return;
    const t = setInterval(fetchJobs, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [pollingEnabled, hasActiveJobs, page, perPage, filterModel, filterStatus]);

  async function handleRetry(jobId: string) {
    setRetryingId(jobId);
    try {
      const res = await fetch(`/api/jobs/${jobId}/retry`, { method: "POST" });
      if (res.ok) {
        await fetchJobs();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Retry failed");
      }
    } catch {
      alert("Retry failed");
    } finally {
      setRetryingId(null);
    }
  }

  // When a job that is expanded or was expanded (in cache) becomes completed, refetch its details to load the output video
  useEffect(() => {
    jobs.forEach((j) => {
      if (j.status !== JOB_STATUS.COMPLETED) return;
      const isRelevant = expandedId === j.id || detailsCache[j.id];
      if (!isRelevant) return;
      if (detailsCache[j.id]?.outputVideoUrl) return;
      fetch(`/api/jobs/${j.id}/details`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data: JobDetails | null) => {
          if (data) setDetailsCache((c) => ({ ...c, [j.id]: data }));
        });
    });
  }, [jobs, expandedId, detailsCache]);

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

  if (!loading && total === 0 && !filterModel && !filterStatus) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-zinc-600 dark:text-zinc-400">
            No jobs yet. Jobs are created when new images appear in a template’s
            Dropbox source folder.
          </p>
        </div>
      </div>
    );
  }

  const statusFilterOptions = [
    { value: "", label: "All statuses" },
    { value: JOB_STATUS.QUEUED, label: "Queued" },
    { value: JOB_STATUS.PROCESSING, label: "Processing" },
    { value: JOB_STATUS.COMPLETED, label: "Completed" },
    { value: JOB_STATUS.FAILED, label: "Failed" },
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Filter</span>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Model</span>
          <select
            value={filterModel}
            onChange={(e) => {
              setFilterModel(e.target.value);
              setPage(1);
            }}
            className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          >
            <option value="">All models</option>
            {VIDEO_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Status</span>
          <select
            value={filterStatus}
            onChange={(e) => {
              setFilterStatus(e.target.value);
              setPage(1);
            }}
            className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          >
            {statusFilterOptions.map((opt) => (
              <option key={opt.value || "all"} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50/80 dark:border-zinc-700 dark:bg-zinc-800/80">
              <th className="w-10 px-2 py-3" aria-label="Expand" />
              <th className="px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300">
                Template
              </th>
              <th className="px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300">
                Model
              </th>
              <th className="px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300">
                Status
              </th>
              <th className="px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300">
                Duration
              </th>
              <th className="px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300">
                Cost
              </th>
              <th className="w-24 px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300" aria-label="Actions">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  No jobs match the current filters.
                </td>
              </tr>
            ) : (
              jobs.map((j) => (
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
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                    {modelLabel(j.model)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor(j.status)}`}
                    >
                      {(j.status === JOB_STATUS.QUEUED || j.status === JOB_STATUS.PROCESSING || j.status === JOB_STATUS.SENT_TO_VEO) && (
                        <StatusSpinner />
                      )}
                      {statusLabel(j.status)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-zinc-600 dark:text-zinc-400 tabular-nums">
                    {formatDuration(j.createdAt, j.completedAt)}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                    {j.creditCost != null ? (
                      <span title={`API: ${j.apiCost?.toFixed(2) ?? "—"} credits`}>
                        {j.creditCost.toFixed(2)} credits
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {j.status === JOB_STATUS.FAILED && (
                      <button
                        type="button"
                        onClick={() => handleRetry(j.id)}
                        disabled={retryingId === j.id}
                        className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                        title="Retry this job"
                      >
                        {retryingId === j.id ? "Retrying…" : "Retry"}
                      </button>
                    )}
                  </td>
                </tr>
                {expandedId === j.id && (
                  <tr className="border-b border-zinc-100 bg-zinc-50/50 dark:border-zinc-700/50 dark:bg-zinc-800/30">
                    <td colSpan={7} className="px-4 py-4">
                      {detailsLoading === j.id ? (
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading details…</p>
                      ) : (
                        <JobDetailsPanel job={j} details={detailsCache[j.id]} />
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-3 border-t border-zinc-200 px-4 py-3 dark:border-zinc-700 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {total > 0
              ? `Showing ${start}–${end} of ${total}`
              : "No jobs"}
          </p>
          {total > perPage && (
            <nav className="flex items-center gap-1" aria-label="Pagination">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
              >
                Previous
              </button>
              <span className="px-2 text-xs text-zinc-500 dark:text-zinc-400">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
              >
                Next
              </button>
            </nav>
          )}
          <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <span>Per page</span>
            <select
              value={perPage}
              onChange={(e) => {
                setPerPage(Number(e.target.value));
                setPage(1);
              }}
              className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            >
              {PER_PAGE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {pollingEnabled && hasActiveJobs
              ? "Auto-refreshing every 5s."
              : !pollingEnabled
                ? "Auto-refresh paused."
                : "No active jobs; refresh paused."}
          </p>
          <button
            type="button"
            onClick={() => setPollingEnabled((p) => !p)}
            className="text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            {pollingEnabled ? "Pause auto-refresh" : "Resume auto-refresh"}
          </button>
        </div>
      </div>
    </div>
  );
}
