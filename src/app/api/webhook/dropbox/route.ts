import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { prisma } from "@/lib/prisma";
import {
  getValidAccessToken,
  listFolderWithCursor,
  listFolderContinue,
} from "@/lib/dropbox";
import { startJobWorkflow } from "@/lib/start-job-workflow";

/** GET: Dropbox webhook verification - echo the challenge parameter */
export async function GET(request: NextRequest) {
  const challenge = request.nextUrl.searchParams.get("challenge");
  if (!challenge) {
    return new NextResponse("Missing challenge", { status: 400 });
  }
  return new NextResponse(challenge, {
    status: 200,
    headers: {
      "Content-Type": "text/plain",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** POST: Dropbox webhook notification - process list_folder changes */
export async function POST(request: NextRequest) {
  const secret = process.env.DROPBOX_APP_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const signature = request.headers.get("x-dropbox-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 401 });
  }

  const rawBody = await request.text();
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (signature !== expected) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: { list_folder?: { accounts?: string[] }; delta?: { users?: string[] } };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const accounts = payload.list_folder?.accounts ?? payload.delta?.users ?? [];
  console.log("[Dropbox webhook] POST received", { accountsCount: accounts.length, accounts: accounts.slice(0, 3) });
  if (accounts.length === 0) {
    console.log("[Dropbox webhook] No accounts in payload, returning 200");
    return new NextResponse(null, { status: 200 });
  }

  // Stagger concurrent webhook deliveries to reduce race conditions and cursor conflicts
  const staggerMs = Math.floor(Math.random() * 3000);
  await new Promise((r) => setTimeout(r, staggerMs));
  console.log("[Dropbox webhook] Stagger done", { staggerMs });

  for (const rawAccountId of accounts) {
    const accountId = typeof rawAccountId === "string" ? rawAccountId : String(rawAccountId);
    const normalized = accountId.startsWith("dbid:") ? accountId : `dbid:${accountId}`;
    const user = await prisma.user.findFirst({
      where: {
        dropboxAccessToken: { not: null },
        OR: [
          { dropboxAccountId: accountId },
          { dropboxAccountId: normalized },
          { dropboxAccountId: accountId.replace(/^dbid:/, "") },
        ],
      },
      select: { id: true },
    });
    if (!user) {
      console.log("[Dropbox webhook] No user for account", { accountId: accountId.slice(0, 12) });
      continue;
    }

    const token = await getValidAccessToken(user.id);
    if (!token) {
      console.log("[Dropbox webhook] No valid token for user", { userId: user.id });
      continue;
    }

    const templates = await prisma.template.findMany({
      where: {
        userId: user.id,
        enabled: true,
        dropboxSourcePath: { not: null },
      },
      select: {
        id: true,
        name: true,
        model: true,
        dropboxSourcePath: true,
        dropboxSourceCursor: true,
      },
    });

    console.log("[Dropbox webhook] User templates", { userId: user.id, templatesCount: templates.length, templates: templates.map((t) => ({ id: t.id, name: t.name, model: t.model, path: t.dropboxSourcePath, hasCursor: !!t.dropboxSourceCursor })) });

    for (const template of templates) {
      const path = template.dropboxSourcePath!;
      let cursor = template.dropboxSourceCursor;
      let hasMore = true;
      let newCursor = cursor;

      const userId = user.id;
      async function processEntries(entries: { ".tag"?: string; name?: string; path_display?: string; id?: string }[]) {
        const list = entries ?? [];
        const fileCount = list.filter((e) => e[".tag"] === "file").length;
        if (fileCount > 0) {
          console.log("[Dropbox webhook] Processing entries", { templateId: template.id, templateName: template.name, entriesCount: list.length, fileCount });
        }
        for (const entry of list) {
          if (entry[".tag"] !== "file") continue;
          const filename = entry.name ?? entry.path_display?.split("/").pop() ?? "unknown";
          const sourceFilePath = entry.path_display ?? `${path}/${filename}`.replace(/\/\/+/g, "/");
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
          console.log("[Dropbox webhook] New file:", { name: filename, path: sourceFilePath, fileId: fileId ?? "none", template: template.name });
          const job = await prisma.job.create({
            data: {
              userId,
              templateId: template.id,
              status: "queued",
              dropboxSourceFilePath: sourceFilePath,
              dropboxSourceFileId: fileId ?? null,
            },
          });
          const host = process.env.HOSTNAME ?? "http://localhost:3000";
          startJobWorkflow({
            jobId: job.id,
            callbackBaseUrl: host.replace(/\/$/, ""),
          }).catch((err) => console.error("[Dropbox webhook] Start job workflow failed:", err));
          console.log("[Dropbox webhook] Job created and workflow started", { jobId: job.id, templateName: template.name, model: template.model });
        }
      }

      try {
        if (!cursor) {
          console.log("[Dropbox webhook] Initial listing (no cursor)", { templateId: template.id, templateName: template.name, path });
          const initial = await listFolderWithCursor(token, path);
          console.log("[Dropbox webhook] Initial list_folder response", { templateId: template.id, entriesCount: initial.entries.length, hasMore: initial.has_more });
          await processEntries(initial.entries);
          newCursor = initial.cursor;
          hasMore = initial.has_more;
          while (hasMore && newCursor) {
            const next = await listFolderContinue(token, newCursor);
            console.log("[Dropbox webhook] list_folder/continue page", { templateId: template.id, entriesCount: next.entries.length, hasMore: next.has_more });
            await processEntries(next.entries);
            newCursor = next.cursor;
            hasMore = next.has_more;
          }
          await prisma.template.update({
            where: { id: template.id },
            data: { dropboxSourceCursor: newCursor },
          });
          console.log("[Dropbox webhook] Cursor saved (initial run)", { templateId: template.id, templateName: template.name });
          continue;
        }

        console.log("[Dropbox webhook] Delta (has cursor)", { templateId: template.id, templateName: template.name, path });
        while (hasMore && newCursor) {
          const result = await listFolderContinue(token, newCursor);
          console.log("[Dropbox webhook] list_folder/continue delta", { templateId: template.id, entriesCount: result.entries.length, hasMore: result.has_more });
          newCursor = result.cursor;
          hasMore = result.has_more;
          await processEntries(result.entries);
        }

        if (newCursor) {
          await prisma.template.update({
            where: { id: template.id },
            data: { dropboxSourceCursor: newCursor },
          });
          console.log("[Dropbox webhook] Cursor updated (delta)", { templateId: template.id, templateName: template.name });
        }
      } catch (err) {
        console.error(`[Dropbox webhook] Error processing template ${template.id}:`, err);
      }
    }
  }

  return new NextResponse(null, { status: 200 });
}
