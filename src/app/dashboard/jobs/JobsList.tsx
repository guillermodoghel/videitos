"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { VIDEO_MODELS } from "@/lib/video-models";
import { JOB_STATUS } from "@/lib/constants/job-status";
import { JOB_ERROR } from "@/lib/constants/job-error-messages";
import { getJobWorkflowPhaseLabel } from "@/lib/job-workflow-phase-label";
import { appendRunwayProgressToLabel } from "@/lib/runway-progress-display";
import { isActiveJobStatus } from "@/lib/job-live-update";
import { JobActiveStatusDisplay } from "./JobActiveStatusDisplay";
import { JobWorkflowProgressGraph } from "./JobWorkflowProgressGraph";
import { mergeJobLiveUpdates, type JobLiveUpdate } from "@/lib/job-live-update";

type JobRow = {
  id: string;
  userEmail?: string;
  userId?: string;
  status: string;
  templateName: string;
  model: string;
  dropboxSourceFilePath: string;
  thumbnailUrl: string;
  providerOperationId: string | null;
  outputDropboxPath: string | null;
  preGenImageKey: string | null;
  errorMessage: string | null;
  dropboxUploadErrorDetail: string | null;
  workflowPhase: string | null;
  runwayProgress: number | null;
  runwayPollStatus: string | null;
  canRetryDropboxUpload: boolean;
  apiCost: number | null;
  creditCost: number | null;
  createdAt: string;
  sentAt: string | null;
  completedAt: string | null;
};

type JobOutputHistoryEntry = {
  version: number;
  isCurrent: boolean;
  completedAt: string;
  creditCost: number | null;
  outputVideoUrl: string | null;
};

type JobDetails = {
  referenceImageUrls: string[];
  preGenImageUrl: string | null;
  outputVideoUrl: string | null;
  outputHistory: JobOutputHistoryEntry[];
};

const LIST_POLL_MS = 10_000;
const EXPANDED_POLL_MS = 5_000;
const FULL_SYNC_EVERY_LIVE_POLLS = 6;
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

function statusLabel(
  status: string,
  errorMessage: string | null | undefined,
  workflowPhase: string | null | undefined,
  runwayProgress: number | null | undefined,
  runwayPollStatus: string | null | undefined
): string {
  const phaseLabel = getJobWorkflowPhaseLabel(
    status,
    workflowPhase,
    runwayProgress,
    runwayPollStatus
  );
  if (phaseLabel) return phaseLabel;
  if (status === JOB_STATUS.FAILED && errorMessage === JOB_ERROR.CANCELED) return "Canceled";
  const labels: Record<string, string> = {
    [JOB_STATUS.QUEUED]: "Queued",
    [JOB_STATUS.PROCESSING]: "Processing",
    [JOB_STATUS.COMPLETED]: "Completed",
    [JOB_STATUS.FAILED]: "Failed",
    [JOB_STATUS.SENT_TO_VEO]: "Processing", // legacy
  };
  const base = labels[status] ?? status;
  if (isActiveJobStatus(status)) {
    return appendRunwayProgressToLabel(base, runwayPollStatus, runwayProgress);
  }
  return base;
}

function statusColor(
  status: string,
  errorMessage: string | null | undefined,
  workflowPhase: string | null | undefined,
  runwayProgress: number | null | undefined,
  runwayPollStatus: string | null | undefined
): string {
  if (getJobWorkflowPhaseLabel(status, workflowPhase, runwayProgress, runwayPollStatus)) {
    return "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300";
  }
  if (status === JOB_STATUS.FAILED && errorMessage === JOB_ERROR.CANCELED)
    return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/40 dark:text-zinc-300";
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

function sourceFileLabel(path: string): string {
  return path.split("/").pop() ?? path;
}

function formatHistoryDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatSyncedAgo(ts: number | null): string | null {
  if (ts == null) return null;
  const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (secs < 8) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const m = Math.floor(secs / 60);
  return `${m}m ago`;
}

function JobSourceThumbnail({
  thumbnailUrl,
  sourcePath,
}: {
  thumbnailUrl: string;
  sourcePath: string;
}) {
  const label = sourceFileLabel(sourcePath);
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-zinc-200 bg-zinc-100 text-[10px] text-zinc-400 dark:border-zinc-600 dark:bg-zinc-800"
        title={label}
      >
        —
      </span>
    );
  }

  return (
    <a
      href={thumbnailUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      className="relative block h-10 w-10 shrink-0 overflow-hidden rounded border border-zinc-200 dark:border-zinc-600"
    >
      <Image
        src={thumbnailUrl}
        alt={label}
        width={40}
        height={40}
        className="object-cover"
        sizes="40px"
        onError={() => setFailed(true)}
      />
    </a>
  );
}

function JobDetailsPanel({
  job,
  details,
  onRetake,
  retaking,
}: {
  job: JobRow;
  details?: JobDetails | null;
  onRetake?: () => void;
  retaking?: boolean;
}) {
  const sourceThumbnail = job.thumbnailUrl;
  const hasInputs =
    details &&
    (details.referenceImageUrls.length > 0 || job.dropboxSourceFilePath.length > 0);
  const hasPreGen = details?.preGenImageUrl;
  const outputHistory = details?.outputHistory ?? [];
  const hasOutputHistory = outputHistory.length > 0;
  const isRegenerating =
    hasOutputHistory &&
    isActiveJobStatus(job.status);

  return (
    <div className="space-y-4">
      <JobWorkflowProgressGraph
        status={job.status}
        workflowPhase={job.workflowPhase}
        errorMessage={job.errorMessage}
        runwayProgress={job.runwayProgress}
        runwayPollStatus={job.runwayPollStatus}
      />
      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          IDs
        </h4>
        <dl className="space-y-1 text-sm">
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Job ID</dt>
            <dd className="break-all font-mono text-xs text-zinc-700 dark:text-zinc-300">{job.id}</dd>
          </div>
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Generation ID</dt>
            <dd className="break-all font-mono text-xs text-zinc-700 dark:text-zinc-300">
              {job.providerOperationId ?? "—"}
            </dd>
          </div>
        </dl>
      </div>
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
              {job.dropboxUploadErrorDetail && (
                <>
                  <dt className="mt-2 text-zinc-500 dark:text-zinc-400">Dropbox detail</dt>
                  <dd className="break-all font-mono text-xs text-red-600/90 dark:text-red-400/90">
                    {job.dropboxUploadErrorDetail}
                  </dd>
                </>
              )}
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
            {job.dropboxSourceFilePath && (
              <a
                href={sourceThumbnail}
                target="_blank"
                rel="noopener noreferrer"
                className="relative block h-24 w-24 overflow-hidden rounded-lg border border-zinc-200 shadow-sm dark:border-zinc-600"
              >
                <Image
                  src={sourceThumbnail}
                  alt="Source (new image)"
                  width={96}
                  height={96}
                  className="object-cover"
                  sizes="96px"
                />
              </a>
            )}
          </div>
          {details.referenceImageUrls.length > 0 && (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Ref 1, Ref 2 · Source image
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
      {hasOutputHistory && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {outputHistory.length > 1 ? "Historial de videos" : "Result video"}
          </h4>
          {isRegenerating && (
            <p className="mb-3 text-sm text-sky-700 dark:text-sky-300">
              Generando una nueva versión… Los videos anteriores se conservan abajo.
            </p>
          )}
          <div className="space-y-4">
            {outputHistory.map((entry, index) => (
              <div
                key={`${entry.version}-${entry.isCurrent ? "current" : "archived"}`}
                className={`max-w-lg rounded-lg border p-3 ${
                  entry.isCurrent
                    ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20"
                    : "border-zinc-200 bg-white dark:border-zinc-600 dark:bg-zinc-900/40"
                }`}
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                    {outputHistory.length > 1
                      ? entry.isCurrent
                        ? `Take ${index + 1} (current)`
                        : `Take ${index + 1}`
                      : entry.isCurrent
                        ? "Video actual"
                        : `Versión ${entry.version}`}
                  </span>
                  <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                    {formatHistoryDate(entry.completedAt)}
                    {entry.creditCost != null ? ` · ${entry.creditCost.toFixed(2)} credits` : ""}
                  </span>
                </div>
                {entry.outputVideoUrl ? (
                  <>
                    <video
                      src={entry.outputVideoUrl}
                      controls
                      className="w-full rounded-lg border border-zinc-200 dark:border-zinc-600"
                    >
                      Your browser does not support the video tag.
                    </video>
                    <a
                      href={entry.outputVideoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block text-xs text-zinc-600 hover:underline dark:text-zinc-400"
                    >
                      Abrir en nueva pestaña
                    </a>
                  </>
                ) : (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Video no disponible (archivo no encontrado en almacenamiento).
                  </p>
                )}
                {entry.isCurrent && onRetake && job.status === JOB_STATUS.COMPLETED && (
                  <button
                    type="button"
                    onClick={onRetake}
                    disabled={retaking}
                    className="mt-3 rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  >
                    {retaking ? "Retake…" : "Retake — regenerar con la misma foto"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {details && !hasInputs && !hasPreGen && !hasOutputHistory && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No previews available.</p>
      )}
    </div>
  );
}

export function JobsList({ isAdmin = false }: { isAdmin?: boolean }) {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [total, setTotal] = useState(0);
  const [hasActiveJobs, setHasActiveJobs] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_PER_PAGE);
  const [filterModel, setFilterModel] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterUser, setFilterUser] = useState("");
  const [loading, setLoading] = useState(true);
  const [pollingEnabled, setPollingEnabled] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [, setSyncLabelTick] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const livePollCountRef = useRef(0);
  const didAutoExpandActiveRef = useRef(false);
  const jobStatusRef = useRef<Record<string, string>>({});
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const [detailsCache, setDetailsCache] = useState<Record<string, JobDetails>>({});
  const [detailsLoading, setDetailsLoading] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryingDropboxId, setRetryingDropboxId] = useState<string | null>(null);
  const [retakingId, setRetakingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [selectedForDelete, setSelectedForDelete] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const start = total === 0 ? 0 : (page - 1) * perPage + 1;
  const end = Math.min(page * perPage, total);

  useEffect(() => {
    if (totalPages > 0 && page > totalPages) setPage(totalPages);
  }, [totalPages, page]);

  const loadJobDetails = useCallback((jobId: string, opts?: { showLoading?: boolean }) => {
    if (opts?.showLoading !== false) {
      setDetailsLoading(jobId);
    }
    return fetch(`/api/jobs/${jobId}/details`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: JobDetails | null) => {
        if (data) {
          setDetailsCache((c) => ({
            ...c,
            [jobId]: { ...data, outputHistory: data.outputHistory ?? [] },
          }));
        }
        return data;
      })
      .finally(() => {
        if (opts?.showLoading !== false) {
          setDetailsLoading((current) => (current === jobId ? null : current));
        }
      });
  }, []);

  const fetchJobsFull = useCallback(async (opts?: { silent?: boolean }) => {
    try {
      const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
      if (filterModel) params.set("model", filterModel);
      if (filterStatus) params.set("status", filterStatus);
      if (isAdmin && filterUser.trim()) params.set("user", filterUser.trim());
      const res = await fetch(`/api/jobs?${params}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs ?? []);
        setTotal(data.total ?? 0);
        setHasActiveJobs(data.hasActiveJobs === true);
        setLastSyncedAt(Date.now());
        livePollCountRef.current = 0;
      }
    } catch {
      // keep previous state
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [page, perPage, filterModel, filterStatus, filterUser, isAdmin]);

  const pollLiveJobs = useCallback(async () => {
    const activeIds = jobsRef.current
      .filter((j) => isActiveJobStatus(j.status))
      .map((j) => j.id);
    if (activeIds.length === 0) {
      livePollCountRef.current += 1;
      if (livePollCountRef.current >= FULL_SYNC_EVERY_LIVE_POLLS) {
        await fetchJobsFull({ silent: true });
      }
      return;
    }

    try {
      const res = await fetch(`/api/jobs/live?ids=${activeIds.join(",")}`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { jobs?: JobLiveUpdate[]; hasActiveJobs?: boolean };
      if (typeof data.hasActiveJobs === "boolean") setHasActiveJobs(data.hasActiveJobs);
      const updates = data.jobs ?? [];
      setJobs((prev) => mergeJobLiveUpdates(prev, updates) ?? prev);
      setLastSyncedAt(Date.now());

      livePollCountRef.current += 1;
      if (livePollCountRef.current >= FULL_SYNC_EVERY_LIVE_POLLS) {
        livePollCountRef.current = 0;
        await fetchJobsFull({ silent: true });
      }
    } catch {
      // keep previous state
    }
  }, [fetchJobsFull]);

  useEffect(() => {
    setLoading(true);
    fetchJobsFull();
  }, [fetchJobsFull]);

  useEffect(() => {
    const onVisibility = () => setTabVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (lastSyncedAt == null) return;
    const t = setInterval(() => setSyncLabelTick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, [lastSyncedAt]);

  // Auto-expand the first active job so pipeline + progress are visible without an extra click.
  useEffect(() => {
    if (didAutoExpandActiveRef.current || loading) return;
    const firstActive = jobs.find((j) => isActiveJobStatus(j.status));
    if (!firstActive) return;
    didAutoExpandActiveRef.current = true;
    setExpandedId(firstActive.id);
    void loadJobDetails(firstActive.id);
  }, [jobs, loading, loadJobDetails]);

  useEffect(() => {
    if (!pollingEnabled || !hasActiveJobs || !tabVisible) return;

    const expandedActive =
      expandedId != null &&
      jobsRef.current.some((j) => j.id === expandedId && isActiveJobStatus(j.status));
    const intervalMs = expandedActive ? EXPANDED_POLL_MS : LIST_POLL_MS;

    const tick = () => {
      void pollLiveJobs();
    };
    tick();
    const t = setInterval(tick, intervalMs);
    return () => clearInterval(t);
  }, [pollingEnabled, hasActiveJobs, tabVisible, expandedId, pollLiveJobs]);

  const failedOnPage = jobs.filter((j) => j.status === JOB_STATUS.FAILED);
  const allFailedSelected = failedOnPage.length > 0 && failedOnPage.every((j) => selectedForDelete.has(j.id));

  function toggleSelectFailed(jobId: string) {
    setSelectedForDelete((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }

  function selectAllFailed() {
    setSelectedForDelete((prev) => {
      const next = new Set(prev);
      failedOnPage.forEach((j) => next.add(j.id));
      return next;
    });
  }

  function deselectAll() {
    setSelectedForDelete(new Set());
  }

  async function deleteSelected() {
    if (selectedForDelete.size === 0) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobIds: Array.from(selectedForDelete) }),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.deleted === "number") {
        setSelectedForDelete(new Set());
        await fetchJobsFull();
      }
    } finally {
      setDeleting(false);
    }
  }

  async function handleRetry(jobId: string) {
    setRetryingId(jobId);
    try {
      const res = await fetch(`/api/jobs/${jobId}/retry`, { method: "POST", credentials: "include" });
      if (res.ok) {
        setDetailsCache((c) => {
          const next = { ...c };
          delete next[jobId];
          return next;
        });
        await fetchJobsFull();
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

  async function handleRetake(jobId: string) {
    if (!confirm("Regenerar este video con la misma foto? Se cobrarán créditos al completar.")) {
      return;
    }
    setRetakingId(jobId);
    try {
      const res = await fetch(`/api/jobs/${jobId}/retake`, { method: "POST", credentials: "include" });
      if (res.ok) {
        setDetailsCache((c) => {
          const next = { ...c };
          delete next[jobId];
          return next;
        });
        await fetchJobsFull();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Retake failed");
      }
    } catch {
      alert("Retake failed");
    } finally {
      setRetakingId(null);
    }
  }

  async function handleRetryDropboxUpload(jobId: string) {
    setRetryingDropboxId(jobId);
    try {
      const res = await fetch(`/api/jobs/${jobId}/retry-dropbox-upload`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error ?? "Retry upload failed");
        return;
      }
      setDetailsCache((c) => {
        const next = { ...c };
        delete next[jobId];
        return next;
      });
      await fetchJobsFull();
    } catch {
      alert("Retry upload failed");
    } finally {
      setRetryingDropboxId(null);
    }
  }

  async function handleCancel(jobId: string) {
    setCancellingId(jobId);
    try {
      const res = await fetch(`/api/jobs/${jobId}/cancel`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        await fetchJobsFull();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Cancel failed");
      }
    } catch {
      alert("Cancel failed");
    } finally {
      setCancellingId(null);
    }
  }

  // Refresh expanded details when a job completes (e.g. after retake) so take history updates.
  useEffect(() => {
    for (const j of jobs) {
      const prev = jobStatusRef.current[j.id];
      jobStatusRef.current[j.id] = j.status;
      if (j.status !== JOB_STATUS.COMPLETED || prev === JOB_STATUS.COMPLETED) continue;
      if (expandedId !== j.id) continue;
      setDetailsCache((c) => {
        const next = { ...c };
        delete next[j.id];
        return next;
      });
      void loadJobDetails(j.id, { showLoading: false });
    }
  }, [jobs, expandedId, loadJobDetails]);

  function toggleExpand(jobId: string) {
    if (expandedId === jobId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(jobId);
    void loadJobDetails(jobId);
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
          <p className="text-zinc-600 dark:text-zinc-400">No jobs yet.</p>
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
        {isAdmin && (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">User</span>
            <input
              type="text"
              value={filterUser}
              onChange={(e) => {
                setFilterUser(e.target.value);
                setPage(1);
              }}
              placeholder="email or user id"
              className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />
          </label>
        )}
        {failedOnPage.length > 0 && (
          <div className="flex items-center gap-2 border-l border-zinc-200 pl-3 dark:border-zinc-700">
            <button
              type="button"
              onClick={allFailedSelected ? deselectAll : selectAllFailed}
              className="text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              {allFailedSelected ? "Deselect all" : "Select all failed"}
            </button>
            {selectedForDelete.size > 0 && (
              <>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {selectedForDelete.size} selected
                </span>
                <button
                  type="button"
                  onClick={deleteSelected}
                  disabled={deleting}
                  className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/50"
                >
                  {deleting ? "Deleting…" : "Delete selected"}
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50/80 dark:border-zinc-700 dark:bg-zinc-800/80">
              <th className="w-8 px-2 py-3" aria-label="Select for delete" />
              <th className="w-10 px-2 py-3" aria-label="Expand" />
              <th className="w-14 px-2 py-3 font-medium text-zinc-700 dark:text-zinc-300">
                Input
              </th>
              {isAdmin && (
                <th className="px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300">
                  User
                </th>
              )}
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
                <td colSpan={isAdmin ? 10 : 9} className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  No jobs match the current filters.
                </td>
              </tr>
            ) : (
              jobs.map((j) => (
              <Fragment key={j.id}>
                <tr className="border-b border-zinc-100 dark:border-zinc-700/50">
                  <td className="px-2 py-3">
                    {j.status === JOB_STATUS.FAILED ? (
                      <input
                        type="checkbox"
                        checked={selectedForDelete.has(j.id)}
                        onChange={() => toggleSelectFailed(j.id)}
                        aria-label={`Select job ${j.templateName} for delete`}
                        className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800"
                      />
                    ) : (
                      <span className="inline-block w-4" aria-hidden />
                    )}
                  </td>
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
                  <td className="px-2 py-3">
                    <JobSourceThumbnail
                      thumbnailUrl={j.thumbnailUrl}
                      sourcePath={j.dropboxSourceFilePath}
                    />
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {j.userEmail ?? j.userId ?? "—"}
                    </td>
                  )}
                  <td className="px-4 py-3 text-zinc-900 dark:text-zinc-100">
                    {j.templateName}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                    {modelLabel(j.model)}
                  </td>
                  <td className="min-w-[11rem] px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors duration-300 ${statusColor(j.status, j.errorMessage, j.workflowPhase, j.runwayProgress, j.runwayPollStatus)}`}
                    >
                      {(j.status === JOB_STATUS.QUEUED || j.status === JOB_STATUS.PROCESSING || j.status === JOB_STATUS.SENT_TO_VEO) && (
                        <StatusSpinner />
                      )}
                      {statusLabel(j.status, j.errorMessage, j.workflowPhase, j.runwayProgress, j.runwayPollStatus)}
                    </span>
                    <JobActiveStatusDisplay
                      status={j.status}
                      workflowPhase={j.workflowPhase}
                      errorMessage={j.errorMessage}
                      runwayProgress={j.runwayProgress}
                      runwayPollStatus={j.runwayPollStatus}
                    />
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
                    {(j.status === JOB_STATUS.QUEUED || j.status === JOB_STATUS.PROCESSING || j.status === JOB_STATUS.SENT_TO_VEO) && (
                      <button
                        type="button"
                        onClick={() => handleCancel(j.id)}
                        disabled={cancellingId === j.id}
                        className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800/30 dark:text-zinc-200 dark:hover:bg-zinc-700"
                        title="Cancel job"
                      >
                        {cancellingId === j.id ? "Canceling…" : "Cancel"}
                      </button>
                    )}
                    {j.status === JOB_STATUS.COMPLETED && (
                      <button
                        type="button"
                        onClick={() => handleRetake(j.id)}
                        disabled={retakingId === j.id}
                        className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                        title="Regenerar video con la misma foto"
                      >
                        {retakingId === j.id ? "Retake…" : "Retake"}
                      </button>
                    )}
                    {j.status === JOB_STATUS.FAILED && j.canRetryDropboxUpload && (
                      <button
                        type="button"
                        onClick={() => handleRetryDropboxUpload(j.id)}
                        disabled={retryingDropboxId === j.id}
                        className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200 dark:hover:bg-amber-900/50"
                        title="Re-upload the generated video to Dropbox (no new Runway generation)"
                      >
                        {retryingDropboxId === j.id ? "Uploading…" : "Retry Dropbox upload"}
                      </button>
                    )}
                    {j.status === JOB_STATUS.FAILED && !j.canRetryDropboxUpload && (
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
                    <td colSpan={isAdmin ? 10 : 9} className="overflow-visible px-4 py-4">
                      <JobDetailsPanel
                        job={j}
                        details={detailsCache[j.id]}
                        onRetake={
                          j.status === JOB_STATUS.COMPLETED
                            ? () => handleRetake(j.id)
                            : undefined
                        }
                        retaking={retakingId === j.id}
                      />
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
          {pollingEnabled && hasActiveJobs && tabVisible && (
            <span className="inline-flex items-center gap-1.5 text-xs text-sky-600 dark:text-sky-400">
              <span className="relative flex h-2 w-2" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500 dark:bg-sky-400" />
              </span>
              Live
              {formatSyncedAgo(lastSyncedAt) ? ` · ${formatSyncedAgo(lastSyncedAt)}` : ""}
            </span>
          )}
          {!tabVisible && pollingEnabled && hasActiveJobs && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Paused (tab hidden)</span>
          )}
          <button
            type="button"
            onClick={() => void fetchJobsFull({ silent: true })}
            className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setPollingEnabled((p) => !p)}
            className="text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            {pollingEnabled ? "Pause live updates" : "Resume live updates"}
          </button>
          {!hasActiveJobs && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">No active jobs</span>
          )}
        </div>
      </div>
    </div>
  );
}
