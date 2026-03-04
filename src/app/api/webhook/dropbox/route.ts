import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { prisma } from "@/lib/prisma";
import {
  getValidAccessToken,
  listFolderWithCursor,
  listFolderContinue,
} from "@/lib/dropbox";
import { enqueueJobTask } from "@/lib/cloud-tasks";

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
  if (accounts.length === 0) {
    return new NextResponse(null, { status: 200 });
  }

  // Stagger concurrent webhook deliveries to reduce race conditions and cursor conflicts
  await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 3000)));

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
    if (!user) continue;

    const token = await getValidAccessToken(user.id);
    if (!token) continue;

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

    for (const template of templates) {
      const path = template.dropboxSourcePath!;
      let cursor = template.dropboxSourceCursor;
      let hasMore = true;
      let newCursor = cursor;

      try {
        if (!cursor) {
          const initial = await listFolderWithCursor(token, path);
          newCursor = initial.cursor;
          hasMore = initial.has_more;
          while (hasMore && newCursor) {
            const next = await listFolderContinue(token, newCursor);
            newCursor = next.cursor;
            hasMore = next.has_more;
          }
          await prisma.template.update({
            where: { id: template.id },
            data: { dropboxSourceCursor: newCursor },
          });
          continue;
        }

        while (hasMore && newCursor) {
          const result = await listFolderContinue(token, newCursor);
          newCursor = result.cursor;
          hasMore = result.has_more;

          for (const entry of result.entries ?? []) {
            const tag = entry[".tag"];
            if (tag === "file") {
              const filename = entry.name ?? entry.path_display?.split("/").pop() ?? "unknown";
              const sourceFilePath = entry.path_display ?? `${path}/${filename}`.replace(/\/\/+/g, "/");
              const fileId = entry.id ?? (entry as Record<string, unknown>).id as string | undefined;
              const recentCutoff = new Date(Date.now() - 10 * 60 * 1000);
              // Dedupe by file id when available (re-upload = new id = new job); else by path
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
              console.log(`[Dropbox webhook] New file: name=${filename}, path=${sourceFilePath}, fileId=${fileId ?? "none"} (template: ${template.name})`);
              const job = await prisma.job.create({
                data: {
                  userId: user.id,
                  templateId: template.id,
                  status: "queued",
                  dropboxSourceFilePath: sourceFilePath,
                  dropboxSourceFileId: fileId ?? null,
                },
              });
              const host = process.env.HOSTNAME ?? "http://localhost:3000";
              enqueueJobTask({
                userId: user.id,
                modelId: template.model,
                jobId: job.id,
                callbackBaseUrl: host.replace(/\/$/, ""),
              }).catch((err) => console.error("[Dropbox webhook] Enqueue Cloud Task failed:", err));
            }
          }
        }

        if (newCursor) {
          await prisma.template.update({
            where: { id: template.id },
            data: { dropboxSourceCursor: newCursor },
          });
        }
      } catch (err) {
        console.error(`[Dropbox webhook] Error processing template ${template.id}:`, err);
      }
    }
  }

  return new NextResponse(null, { status: 200 });
}
