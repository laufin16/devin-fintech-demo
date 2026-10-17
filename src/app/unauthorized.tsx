"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export default function Unauthorized() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const params = new URLSearchParams({ next: search ? `${pathname}?${search}` : pathname, reason: "expired" });
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        <h1 className="font-semibold">401 — Session expired</h1>
        <p className="mt-1">Your session is no longer valid, so nothing was saved. Sign in again to continue.</p>
        <Link href={`/login?${params}`} className="mt-4 inline-block font-medium underline">Sign in</Link>
      </div>
    </main>
  );
}
