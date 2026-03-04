import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { listFolder, createFolder, getValidAccessToken } from "@/lib/dropbox";

/** GET ?path=  - list folder (path empty for root, or /Folder/Sub) */
export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = await getValidAccessToken(userId);
  if (!token) {
    return NextResponse.json({ error: "Dropbox not connected" }, { status: 403 });
  }
  const path = request.nextUrl.searchParams.get("path") ?? "";
  try {
    const data = await listFolder(token, path);
    const entries = (data.entries ?? []).map((e) => ({
      name: e.name,
      tag: e[".tag"],
      path_display: e.path_display ?? "",
      path_lower: e.path_lower ?? "",
      isFolder: e[".tag"] === "folder",
    }));
    return NextResponse.json({ entries });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "List failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

/** POST { "path": "/Full/Path/To/NewFolder" } - create folder */
export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = await getValidAccessToken(userId);
  if (!token) {
    return NextResponse.json({ error: "Dropbox not connected" }, { status: 403 });
  }
  let body: { path?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const path = typeof body.path === "string" ? body.path.trim() : "";
  if (!path) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }
  try {
    const result = await createFolder(token, path);
    return NextResponse.json({
      name: result.metadata.name,
      path_display: result.metadata.path_display,
      path_lower: result.metadata.path_lower,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Create folder failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
