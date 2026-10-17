"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { requireActionContext } from "@/lib/auth/current";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { revokeAllSessions, revokeSession } from "@/lib/auth/sessions";

export async function logoutAction(): Promise<void> {
  const { user, requestId } = await requireActionContext();
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) revokeSession(getDb(), token, user.id, requestId);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

export async function logoutEverywhereAction(): Promise<void> {
  const { user, requestId } = await requireActionContext();
  revokeAllSessions(getDb(), user.id, user.id, requestId);
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
