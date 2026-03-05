import { NextResponse, type NextRequest } from "next/server";

const WORKFLOW_INTERNAL_HEADER = "x-workflow-internal-fetch";

/**
 * For workflow flow/step endpoints, proxy the request so we can log 503 responses.
 * The WDK returns 503 when the flow handler is busy (e.g. right after a step); the
 * workflow runtime retries and succeeds, so we only log for visibility.
 */
export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  if (request.headers.get(WORKFLOW_INTERNAL_HEADER)) {
    return NextResponse.next();
  }

  if (
    path === "/.well-known/workflow/v1/flow" ||
    path === "/.well-known/workflow/v1/step"
  ) {
    const url = new URL(
      request.nextUrl.pathname + request.nextUrl.search,
      request.nextUrl.origin,
    );
    const headers = new Headers(request.headers);
    headers.set(WORKFLOW_INTERNAL_HEADER, "1");

    const body =
      request.method !== "GET" && request.method !== "HEAD"
        ? await request.arrayBuffer()
        : undefined;

    const res = await fetch(url.toString(), {
      method: request.method,
      headers,
      body,
    });

    if (res.status === 503) {
      console.warn(
        `[Workflow] 503 ${request.method} ${path}`,
        request.nextUrl.search || "",
      );
    }

    return new NextResponse(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/.well-known/workflow/v1/flow", "/.well-known/workflow/v1/step"],
};
