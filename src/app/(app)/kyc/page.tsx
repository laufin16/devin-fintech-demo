import Link from "next/link";
import { requirePermission } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { KYC_STATUSES, kycActionItemFor, kycQueueStats, kycWaitingText, listCases, slaState } from "@/lib/kyc";
import { RiskBadge, StatusBadge } from "@/components/status-badge";
import { KycActions } from "./kyc-actions";

const label = (s: string) => s[0].toUpperCase() + s.slice(1).replace("_", " ");

export default async function KycQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; mine?: string }>;
}) {
  const user = await requirePermission("kyc:view");
  const db = getDb();
  const { status: rawStatus, mine } = await searchParams;
  const status = KYC_STATUSES.find((s) => s === rawStatus);
  const assignedToMe = mine === "1";
  const cases = listCases(db, user, { status, assignedToMe });
  const stats = kycQueueStats(db, user);
  const total = KYC_STATUSES.reduce((n, s) => n + stats.counts[s], 0);

  const tab = (href: string, text: string, n: number | null, active: boolean) => (
    <Link
      key={href}
      href={href}
      className={`rounded-md px-3 py-1.5 text-sm ${active ? "bg-white font-medium shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-slate-900"}`}
    >
      {text} {n !== null && <span className="text-slate-400">{n}</span>}
    </Link>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">KYC Review Queue</h1>
        <p className="mt-1 text-sm text-slate-500">
          {stats.open} open · {stats.overdue} past SLA. Sorted by SLA, then risk. A customer&apos;s refunds can only be
          paid out once their KYC is approved.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
          {tab("/kyc", "All", total, !status && !assignedToMe)}
          {KYC_STATUSES.map((s) => tab(`/kyc?status=${s}`, label(s), stats.counts[s], status === s && !assignedToMe))}
        </div>
        <div className="inline-flex rounded-lg bg-slate-100 p-1">{tab("/kyc?mine=1", "Assigned to me", null, assignedToMe)}</div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Case</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Risk</th>
              <th className="px-4 py-3">SLA</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Assignee</th>
              <th className="px-4 py-3">Action item</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cases.map((c) => {
              const item = kycActionItemFor(user, c);
              const sla = slaState(c);
              return (
                <tr key={c.id} className="align-top">
                  <td className="px-4 py-3">
                    <Link href={`/kyc/${c.id}`} className="font-mono text-indigo-600 hover:underline">{c.id}</Link>
                    <div className="text-xs text-slate-500">Opened {new Date(c.createdAt).toLocaleDateString("en-US")}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div>{c.customerName}</div>
                    <div className="text-xs text-slate-500">{c.customerEmail}</div>
                  </td>
                  <td className="px-4 py-3"><RiskBadge risk={c.riskLevel} /></td>
                  <td className={`whitespace-nowrap px-4 py-3 text-xs ${sla?.overdue ? "font-medium text-red-700" : "text-slate-600"}`}>
                    {sla?.label ?? "—"}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-4 py-3 text-slate-700">{c.assigneeName ?? "Unassigned"}</td>
                  <td className="px-4 py-3">
                    {item ? (
                      <KycActions caseId={c.id} version={c.version} label={item.label} intents={item.intents} compact />
                    ) : (
                      <span className="text-xs text-slate-400">{kycWaitingText(c)}</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {cases.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">No KYC cases match this filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
