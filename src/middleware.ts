import { NextResponse, type NextRequest } from "next/server";
import { PUBLIC_PATHS, SESSION_COOKIE } from "@/lib/auth/constants";

// Coarse gate: no session cookie -> 401 / redirect. Every page, API route and server action
// still validates the session server-side (requireUser / withAuth). Server actions can be invoked
// via any page URL (including public ones), so they are never public here.
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-request-id", crypto.randomUUID());
  requestHeaders.set("x-pathname", pathname + search);

  const isServerAction = req.headers.has("next-action");
  if (!req.cookies.has(SESSION_COOKIE) && (isServerAction || !PUBLIC_PATHS.includes(pathname))) {
    if (isServerAction || pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
