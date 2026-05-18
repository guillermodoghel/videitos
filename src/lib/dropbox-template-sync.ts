import { prisma } from "@/lib/prisma";
import { JOB_STATUS } from "@/lib/constants/job-status";
import {
  DropboxListFolderResetError,
  listFolderContinue,
  listFolderWithCursor,
} from "@/lib/dropbox";
import { isUnderDropboxSourcePath } from "@/lib/dropbox-path";
import { startJobWorkflow } from "@/lib/start-job-workflow";

type ListFolderEntry = {
  ".tag"?: string;
  name?: string;
  path_display?: string;
  id?: string;
};

export type DropboxTemplateSyncInput = {
  id: string;
  name: string;
  model: string;
  dropboxSourcePath: string;
  dropboxSourceCursor: string | null;
};

async function saveCursorIfUnchanged(
  templateId: string,
  expectedCursor: string | null,
  newCursor: string
): Promise<boolean> {
  const result = await prisma.template.updateMany({
    where: { id: templateId, dropboxSourceCursor: expectedCursor },
    data: { dropboxSourceCursor: newCursor },
  });
  return result.count > 0;
}

/**
 * Poll Dropbox for new files under a template source folder and enqueue jobs.
 * Returns counts for logging; throws on unexpected API errors.
 */
export async function syncTemplateFromDropbox(
  accessToken: string,
  template: DropboxTemplateSyncInput,
  userId: string
): Promise<{ jobsCreated: number; filesSeen: number }> {
  const path = template.dropboxSourcePath;
  let cursor = template.dropboxSourceCursor;
  let jobsCreated = 0;
  let filesSeen = 0;

  async function processEntries(entries: ListFolderEntry[]) {
    const list = entries ?? [];
    const files = list.filter((e) => e[".tag"] === "file");
    filesSeen += files.length;
    if (files.length > 0) {
      console.log("[Dropbox webhook] Processing entries", {
        templateId: template.id,
        templateName: template.name,
        entriesCount: list.length,
        fileCount: files.length,
      });
    }
    for (const entry of files) {
      const filename = entry.name ?? entry.path_display?.split("/").pop() ?? "unknown";
      const sourceFilePath = entry.path_display ?? `${path}/${filename}`.replace(/\/\/+/g, "/");
      if (!isUnderDropboxSourcePath(sourceFilePath, path)) continue;

      const fileId = entry.id ?? (entry as Record<string, unknown>).id as string | undefined;
      const recentCutoff = new Date(Date.now() - 10 * 60 * 1000);
      const existing = await prisma.job.findFirst({
        where: {
          templateId: template.id,
          createdAt: { gte: recentCutoff },
          ...(fileId
            ? { dropboxSourceFileId: fileId }
            : { dropboxSourceFilePath: sourceFilePath }),
        },
      });
      if (existing) continue;

      console.log("[Dropbox webhook] New file:", {
        name: filename,
        path: sourceFilePath,
        fileId: fileId ?? "none",
        template: template.name,
      });
      const job = await prisma.job.create({
        data: {
          userId,
          templateId: template.id,
          status: JOB_STATUS.QUEUED,
          dropboxSourceFilePath: sourceFilePath,
          dropboxSourceFileId: fileId ?? null,
        },
      });
      const host = process.env.HOSTNAME ?? "http://localhost:3000";
      startJobWorkflow({
        jobId: job.id,
        callbackBaseUrl: host.replace(/\/$/, ""),
      }).catch((err) => console.error("[Dropbox webhook] Start job workflow failed:", err));
      console.log("[Dropbox webhook] Job created and workflow started", {
        jobId: job.id,
        templateName: template.name,
        model: template.model,
      });
      jobsCreated += 1;
    }
  }

  const runInitialList = async () => {
    console.log("[Dropbox webhook] Initial listing (no cursor)", {
      templateId: template.id,
      templateName: template.name,
      path,
    });
    const initial = await listFolderWithCursor(accessToken, path);
    console.log("[Dropbox webhook] Initial list_folder response", {
      templateId: template.id,
      entriesCount: initial.entries.length,
      hasMore: initial.has_more,
    });
    await processEntries(initial.entries);
    let newCursor = initial.cursor;
    let hasMore = initial.has_more;
    while (hasMore && newCursor) {
      const next = await listFolderContinue(accessToken, newCursor);
      console.log("[Dropbox webhook] list_folder/continue page", {
        templateId: template.id,
        entriesCount: next.entries.length,
        hasMore: next.has_more,
      });
      await processEntries(next.entries);
      newCursor = next.cursor;
      hasMore = next.has_more;
    }
    if (newCursor) {
      const saved = await saveCursorIfUnchanged(template.id, cursor, newCursor);
      console.log("[Dropbox webhook] Cursor saved (initial run)", {
        templateId: template.id,
        templateName: template.name,
        saved,
      });
      cursor = newCursor;
    }
  };

  const runDelta = async () => {
    console.log("[Dropbox webhook] Delta (has cursor)", {
      templateId: template.id,
      templateName: template.name,
      path,
    });
    const startCursor = cursor;
    let newCursor = cursor!;
    let hasMore = true;
    let totalEntries = 0;

    while (hasMore && newCursor) {
      const result = await listFolderContinue(accessToken, newCursor);
      totalEntries += result.entries.length;
      console.log("[Dropbox webhook] list_folder/continue delta", {
        templateId: template.id,
        entriesCount: result.entries.length,
        hasMore: result.has_more,
      });
      newCursor = result.cursor;
      hasMore = result.has_more;
      await processEntries(result.entries);
    }

    if (totalEntries === 0 && jobsCreated === 0) {
      console.log("[Dropbox webhook] Empty delta (account webhook, no folder changes)", {
        templateId: template.id,
        templateName: template.name,
        path,
        hint: "Files must be added under this folder (subfolders included). Changes elsewhere on the account do not appear here.",
      });
    }

    if (newCursor) {
      const saved = await saveCursorIfUnchanged(template.id, startCursor, newCursor);
      console.log("[Dropbox webhook] Cursor updated (delta)", {
        templateId: template.id,
        templateName: template.name,
        saved,
      });
      cursor = newCursor;
    }
  };

  try {
    if (!cursor) {
      await runInitialList();
    } else {
      await runDelta();
    }
  } catch (err) {
    if (err instanceof DropboxListFolderResetError) {
      console.log("[Dropbox webhook] Cursor reset by Dropbox, re-initializing listing", {
        templateId: template.id,
        templateName: template.name,
      });
      await prisma.template.update({
        where: { id: template.id },
        data: { dropboxSourceCursor: null },
      });
      cursor = null;
      await runInitialList();
      return { jobsCreated, filesSeen };
    }
    throw err;
  }

  return { jobsCreated, filesSeen };
}
