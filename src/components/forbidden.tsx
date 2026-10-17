export function Forbidden() {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
      <h1 className="font-semibold">403 — Not permitted</h1>
      <p className="mt-1">Your role does not allow access to this page.</p>
    </div>
  );
}
