"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getRequestId } from "@/lib/auth/current";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { safeNextPath } from "@/lib/auth/redirect";
import { attemptLogin, createSession } from "@/lib/auth/sessions";

export interface LoginState {
  error?: string;
}

// The only server action reachable without a session (allowlisted via PUBLIC_PATHS: /login).
export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const db = getDb();
  const requestId = await getRequestId();
  const result = attemptLogin(db, email, password, requestId);
  if (!result.ok) {
    if (result.reason === "invalid") return { error: "Invalid email or password" };
    const minutes = Math.max(1, Math.ceil(result.retryAfterMs / 60_000));
    return { error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` };
  }

  const { token, expiresAt } = createSession(db, result.user.id, requestId);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  redirect(safeNextPath(formData.get("next")));
}
