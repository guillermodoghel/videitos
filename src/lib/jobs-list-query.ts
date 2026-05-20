import type { Prisma } from "@prisma/client";
import { JOB_STATUS } from "@/lib/constants/job-status";

export const JOB_SORT_OPTIONS = [
  { value: "updatedAt_desc", label: "Recently updated" },
  { value: "updatedAt_asc", label: "Oldest updated" },
  { value: "createdAt_desc", label: "Newest created" },
  { value: "createdAt_asc", label: "Oldest created" },
  { value: "completedAt_desc", label: "Recently completed" },
  { value: "completedAt_asc", label: "Oldest completed" },
] as const;

export type JobSortValue = (typeof JOB_SORT_OPTIONS)[number]["value"];

const SORT_ORDER_BY: Record<JobSortValue, Prisma.JobOrderByWithRelationInput> = {
  updatedAt_desc: { updatedAt: "desc" },
  updatedAt_asc: { updatedAt: "asc" },
  createdAt_desc: { createdAt: "desc" },
  createdAt_asc: { createdAt: "asc" },
  completedAt_desc: { completedAt: "desc" },
  completedAt_asc: { completedAt: "asc" },
};

export const DEFAULT_JOB_SORT: JobSortValue = "updatedAt_desc";

export function parseJobSort(value: string | null | undefined): JobSortValue {
  if (value && value in SORT_ORDER_BY) return value as JobSortValue;
  return DEFAULT_JOB_SORT;
}

export function buildJobOrderBy(sort: JobSortValue): Prisma.JobOrderByWithRelationInput {
  return SORT_ORDER_BY[sort];
}

export type JobsListFilters = {
  model: string | null;
  status: string | null;
  userQuery: string | null;
  search: string | null;
  hasTakes: boolean;
  dropboxRetryOnly: boolean;
};

export function parseJobsListFilters(params: URLSearchParams): JobsListFilters {
  return {
    model: params.get("model")?.trim() || null,
    status: params.get("status")?.trim() || null,
    userQuery: params.get("user")?.trim() || null,
    search: params.get("q")?.trim() || null,
    hasTakes: params.get("hasTakes") === "1",
    dropboxRetryOnly: params.get("dropboxRetry") === "1",
  };
}

export function buildJobsWhere(
  filters: JobsListFilters,
  opts: { userId: string; isAdmin: boolean }
): Prisma.JobWhereInput {
  const and: Prisma.JobWhereInput[] = [];

  if (!opts.isAdmin) and.push({ userId: opts.userId });
  if (filters.status) and.push({ status: filters.status });
  if (filters.model) and.push({ template: { model: filters.model } });

  if (opts.isAdmin && filters.userQuery) {
    and.push({
      OR: [
        { user: { email: { contains: filters.userQuery, mode: "insensitive" } } },
        { userId: { contains: filters.userQuery, mode: "insensitive" } },
      ],
    });
  }

  if (filters.search) {
    const q = filters.search;
    and.push({
      OR: [
        { id: { contains: q, mode: "insensitive" } },
        { dropboxSourceFilePath: { contains: q, mode: "insensitive" } },
        { outputDropboxPath: { contains: q, mode: "insensitive" } },
        { providerOperationId: { contains: q, mode: "insensitive" } },
        { errorMessage: { contains: q, mode: "insensitive" } },
        { template: { name: { contains: q, mode: "insensitive" } } },
        ...(opts.isAdmin
          ? [
              {
                user: {
                  email: { contains: q, mode: "insensitive" as const },
                },
              },
            ]
          : []),
      ],
    });
  }

  if (filters.hasTakes) {
    and.push({ outputHistory: { some: {} } });
  }

  if (filters.dropboxRetryOnly) {
    and.push({
      status: JOB_STATUS.FAILED,
      OR: [
        { errorMessage: { contains: "Dropbox", mode: "insensitive" } },
        { dropboxUploadErrorDetail: { not: null } },
        { runwayOutputVideoUri: { not: null } },
      ],
    });
  }

  return and.length > 0 ? { AND: and } : {};
}

export function hasActiveJobsListFilters(filters: JobsListFilters): boolean {
  return !!(
    filters.model ||
    filters.status ||
    filters.userQuery ||
    filters.search ||
    filters.hasTakes ||
    filters.dropboxRetryOnly
  );
}
