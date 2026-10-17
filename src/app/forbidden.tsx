import Link from "next/link";

export default function Forbidden() {
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
        <h1 className="font-semibold">403 — Not permitted</h1>
        <p className="mt-1">Your role does not allow access to this page. Ask an admin if you think you need it.</p>
        <Link href="/" className="mt-4 inline-block font-medium text-red-900 underline">Back to home</Link>
      </div>
    </main>
  );
}
