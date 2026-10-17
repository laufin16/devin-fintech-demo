import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current";
import { safeNextPath } from "@/lib/auth/redirect";
import { DEMO_PASSWORD } from "@/lib/db/seed";
import { LoginForm } from "./login-form";

const DEMO_ACCOUNTS = [
  { email: "ava@acme.dev", role: "approver" },
  { email: "ben@acme.dev", role: "approver" },
  { email: "sam@acme.dev", role: "admin" },
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reason?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  const { next, reason } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 font-bold text-white">
            A
          </div>
          <h1 className="text-2xl font-semibold">Acme Internal Tools</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to view your tools and assignments</p>
        </div>
        {reason === "expired" && (
          <p role="status" className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Your session expired. Sign in again to continue where you left off.
          </p>
        )}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <LoginForm next={safeNextPath(next)} />
        </div>
        <div className="mt-6 rounded-lg border border-dashed border-slate-300 p-4 text-xs text-slate-500">
          <p className="mb-2 font-medium text-slate-600">Mock accounts (password: {DEMO_PASSWORD})</p>
          <ul className="space-y-1 font-mono">
            {DEMO_ACCOUNTS.map((a) => (
              <li key={a.email}>
                {a.email} — {a.role}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
