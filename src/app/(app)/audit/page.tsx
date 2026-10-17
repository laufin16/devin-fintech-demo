import { requirePermission } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { readRecentAudit } from "@/lib/audit";

export default async function AuditPage() {
  await requirePermission("audit:view");
  const rows = readRecentAudit(getDb());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <p className="mt-1 text-sm text-slate-500">Append-only. Most recent 200 entries.</p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Resource</th>
              <th className="px-4 py-3">Before → After</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 align-top">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2 tabular-nums text-slate-400">{r.id}</td>
                <td className="whitespace-nowrap px-4 py-2 text-slate-600">{new Date(r.created_at).toLocaleString("en-US")}</td>
                <td className="px-4 py-2">{r.actor_name ?? "system"}</td>
                <td className="px-4 py-2 font-mono text-xs">{r.action}</td>
                <td className="px-4 py-2 font-mono text-xs">{r.resource_type}/{r.resource_id}</td>
                <td className="max-w-xl px-4 py-2 font-mono text-xs text-slate-600">
                  <div className="break-all">{r.before_json ?? "∅"}</div>
                  <div className="break-all text-slate-900">→ {r.after_json ?? "∅"}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
