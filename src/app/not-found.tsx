import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm shadow-sm">
        <h1 className="font-semibold">404 — Not found</h1>
        <p className="mt-1 text-slate-600">That page or record doesn&apos;t exist, or it may have been removed.</p>
        <Link href="/" className="mt-4 inline-block font-medium text-indigo-600 hover:underline">Back to home</Link>
      </div>
    </main>
  );
}
