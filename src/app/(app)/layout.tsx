import Link from "next/link";
import { requireUser } from "@/lib/auth/current";
import { can } from "@/lib/policy";
import { logoutAction, logoutEverywhereAction } from "../actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 text-sm text-white">A</span>
            Acme Internal Tools
          </Link>
          <nav className="flex gap-4 text-sm text-slate-600">
            <Link href="/" className="hover:text-slate-900">Home</Link>
            {can(user, "refund:view") && <Link href="/refunds" className="hover:text-slate-900">Refunds</Link>}
            {can(user, "audit:view") && <Link href="/audit" className="hover:text-slate-900">Audit log</Link>}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-slate-700">{user.name}</span>
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">{user.role}</span>
            <form action={logoutAction}>
              <button className="rounded-md border border-slate-300 px-3 py-1 text-slate-700 hover:bg-slate-50">Sign out</button>
            </form>
            <form action={logoutEverywhereAction}>
              <button className="text-xs text-slate-500 hover:text-slate-900 hover:underline">Sign out everywhere</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
