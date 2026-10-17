import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { safeNextPath } from "@/lib/auth/redirect";
import { attemptLogin, createSession } from "@/lib/auth/sessions";

// The only endpoint reachable without a session (allowlisted in PUBLIC_PATHS).
export async function POST(req: NextRequest): Promise<Response> {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Cross-origin login rejected" }, { status: 403 });

  const form = await req.formData();
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const next = safeNextPath(form.get("next"));
  const db = getDb();
  const requestId = req.headers.get("x-request-id") ?? randomUUID();

  const result = attemptLogin(db, email, password, requestId);
  if (!result.ok) {
    const params = new URLSearchParams({ next, error: result.reason });
    if (result.reason === "locked") params.set("retry", String(Math.max(1, Math.ceil(result.retryAfterMs / 60_000))));
    return seeOther(`/login?${params}`);
  }

  const { token, expiresAt } = createSession(db, result.user.id, requestId);
  const res = seeOther(next);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return res;
}

// Relative Location so redirects work behind proxies that rewrite the host.
function seeOther(location: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: location } });
}

// Same check Next applies to server actions: the Origin host must match the request host.
function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
