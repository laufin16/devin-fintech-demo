"use client";

import Link from "next/link";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
      <h1 className="font-semibold">Something went wrong</h1>
      <p className="mt-1">
        The page couldn&apos;t load. Any change in progress was rolled back.
        {error.digest && <span className="ml-1 font-mono text-xs">(ref {error.digest})</span>}
      </p>
      <div className="mt-4 flex gap-3">
        <button onClick={reset} className="rounded-md bg-red-700 px-3 py-1.5 font-medium text-white hover:bg-red-600">
          Try again
        </button>
        <Link href="/" className="rounded-md border border-red-300 px-3 py-1.5 font-medium hover:bg-red-100">
          Back to home
        </Link>
      </div>
    </div>
  );
}
