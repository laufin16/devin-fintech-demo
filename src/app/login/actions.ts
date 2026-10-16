"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getRequestId } from "@/lib/auth/current";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { authenticate, createSession } from "@/lib/auth/sessions";

export interface LoginState {
  error?: string;
}

function safeNext(next: FormDataEntryValue | null): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

// The only server action reachable without a session (allowlisted via PUBLIC_PATHS: /login).
export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const db = getDb();
  const user = authenticate(db, email, password);
  if (!user) return { error: "Invalid email or password" };

  const { token, expiresAt } = createSession(db, user.id, await getRequestId());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  redirect(safeNext(formData.get("next")));
}
