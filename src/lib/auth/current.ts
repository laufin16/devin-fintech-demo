import "server-only";
import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { forbidden, redirect, unauthorized } from "next/navigation";
import { getDb } from "../db";
import { can, type Action } from "../policy";
import type { User } from "../types";
import { SESSION_COOKIE } from "./constants";
import { safeNextPath } from "./redirect";
import { resolveSession } from "./sessions";

export async function getRequestId(): Promise<string> {
  return (await headers()).get("x-request-id") ?? randomUUID();
}

export async function getCurrentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? resolveSession(getDb(), token, await getRequestId()) : null;
}

// For pages and server actions. Without a valid session, redirects to /login and keeps the
// current path as `next`; a cookie that no longer resolves is reported as an expired session.
export async function requireUser(): Promise<User> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = token ? resolveSession(getDb(), token, await getRequestId()) : null;
  if (user) return user;
  const params = new URLSearchParams({ next: safeNextPath((await headers()).get("x-pathname")) });
  if (token) params.set("reason", "expired");
  redirect(`/login?${params}`);
}

// For pages: renders the 403 page (HTTP 403) when the policy denies `action`.
export async function requirePermission(action: Action): Promise<User> {
  const user = await requireUser();
  if (!can(user, action)) forbidden();
  return user;
}

// For server actions: an expired or revoked session gets HTTP 401 (unauthorized.tsx), not a redirect.
export async function requireActionContext(): Promise<{ user: User; requestId: string }> {
  const user = await getCurrentUser();
  if (!user) unauthorized();
  return { user, requestId: await getRequestId() };
}
