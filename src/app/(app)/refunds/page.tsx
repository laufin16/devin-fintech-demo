import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { actionItemFor, countRefundsByStatus, listRefunds, payoutBlockedReason } from "@/lib/refunds";
import type { RefundStatus } from "@/lib/types";
import { StatusBadge } from "@/components/status-badge";
import { RefundActions } from "./refund-actions";

const STATUSES: RefundStatus[] = ["pending", "approved", "rejected", "processed"];

export default async function RefundsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requirePermission("refund:view");
  const db = getDb();
  const { status: rawStatus } = await searchParams;
  const status = STATUSES.find((s) => s === rawStatus);
  const refunds = listRefunds(db, user, { status });
  const counts = countRefundsByStatus(db, user);
  const total = STATUSES.reduce((n, s) => n + counts[s], 0);

  const tab = (href: string, label: string, n: number, active: boolean) => (
    <Link
      key={href}
      href={href}
      className={`rounded-md px-3 py-1.5 text-sm ${active ? "bg-white font-medium shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-slate-900"}`}
    >
      {label} <span className="text-slate-400">{n}</span>
    </Link>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Refund dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">Review refund requests and take action where you are permitted.</p>
      </div>

      <div className="inline-flex gap-1 rounded-lg bg-slate-100 p-1">
        {tab("/refunds", "All", total, !status)}
        {STATUSES.map((s) => tab(`/refunds?status=${s}`, s[0].toUpperCase() + s.slice(1), counts[s], status === s))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Refund request</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Assignee</th>
              <th className="px-4 py-3">Action item</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {refunds.map((r) => {
              const item = actionItemFor(user, r);
              return (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-3">
                    <Link href={`/refunds/${r.id}`} className="font-mono text-indigo-600 hover:underline">{r.id}</Link>
                    <div className="text-xs text-slate-500">
                      {r.order_ref} · {new Date(r.created_at).toLocaleDateString("en-US")}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div>{r.customer_name}</div>
                    <div className="text-xs text-slate-500">{r.customer_email}</div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCents(r.amount_cents, r.currency)}</td>
                  <td className="max-w-56 px-4 py-3 text-slate-700">{r.reason}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3 text-slate-700">{r.assignee_name ?? "Unassigned"}</td>
                  <td className="px-4 py-3">
                    {item ? (
                      <RefundActions
                        refundId={r.id}
                        version={r.version}
                        idempotencyKey={randomUUID()}
                        label={item.label}
                        intents={item.intents}
                        amountLabel={formatCents(r.amount_cents, r.currency)}
                      />
                    ) : payoutBlockedReason(r) ? (
                      <span className="text-xs text-amber-700">{payoutBlockedReason(r)}</span>
                    ) : (
                      <span className="text-xs text-slate-400">
                        {r.status === "approved" ? "Awaiting admin payout" : "No action needed"}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {refunds.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">No refunds match this filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
