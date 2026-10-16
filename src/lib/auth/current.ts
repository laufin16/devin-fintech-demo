import "server-only";
import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "../db";
import type { User } from "../types";
import { SESSION_COOKIE } from "./constants";
import { findUserBySessionToken } from "./sessions";

export async function getCurrentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? findUserBySessionToken(getDb(), token) : null;
}

export async function getRequestId(): Promise<string> {
  return (await headers()).get("x-request-id") ?? randomUUID();
}

// For pages and server actions: redirects to /login when there is no valid session.
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireActionContext(): Promise<{ user: User; requestId: string }> {
  const user = await requireUser();
  return { user, requestId: await getRequestId() };
}
