import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { prisma } from "@/lib/prisma";
import { getValidAccessToken } from "@/lib/dropbox";
import { syncTemplateFromDropbox } from "@/lib/dropbox-template-sync";

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
    const users = await prisma.user.findMany({
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
    if (users.length === 0) {
      console.log("[Dropbox webhook] No user for account", { accountId: accountId.slice(0, 12) });
      continue;
    }
    if (users.length > 1) {
      console.log("[Dropbox webhook] Same Dropbox account linked to multiple users", { accountId: accountId.slice(0, 12), userIds: users.map((u) => u.id) });
    }

    for (const user of users) {
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
        try {
          const result = await syncTemplateFromDropbox(token, {
            id: template.id,
            name: template.name,
            model: template.model,
            dropboxSourcePath: template.dropboxSourcePath!,
            dropboxSourceCursor: template.dropboxSourceCursor,
          }, user.id);
          if (result.jobsCreated > 0) {
            console.log("[Dropbox webhook] Sync complete", {
              templateId: template.id,
              jobsCreated: result.jobsCreated,
              filesSeen: result.filesSeen,
            });
          }
        } catch (err) {
          console.error(`[Dropbox webhook] Error processing template ${template.id}:`, err);
        }
      }
    }
  }

  return new NextResponse(null, { status: 200 });
}
