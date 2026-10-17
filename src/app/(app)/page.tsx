import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { kycActionItemFor, kycQueueStats, listKycAssignments, slaState } from "@/lib/kyc";
import { formatCents } from "@/lib/money";
import { can } from "@/lib/policy";
import { actionItemFor, countRefundsByStatus, listAssignments } from "@/lib/refunds";
import { TOOLS } from "@/lib/tools";
import { RiskBadge, StatusBadge } from "@/components/status-badge";
import { KycActions } from "./kyc/kyc-actions";
import { RefundActions } from "./refunds/refund-actions";

export default async function HomePage() {
  const user = await requireUser();
  const db = getDb();
  const tools = TOOLS.filter((t) => can(user, t.requires));
  const refundAssignments = can(user, "refund:view") ? listAssignments(db, user) : [];
  const kycAssignments = can(user, "kyc:view") ? listKycAssignments(db, user) : [];
  const refundCounts = can(user, "refund:view") ? countRefundsByStatus(db, user) : null;
  const kycStats = can(user, "kyc:view") ? kycQueueStats(db, user) : null;
  const toolStats: Record<string, string | undefined> = {
    "/refunds": refundCounts ? `${refundCounts.pending} pending · ${refundCounts.approved} awaiting payout` : undefined,
    "/kyc": kycStats ? `${kycStats.open} open · ${kycStats.overdue} past SLA` : undefined,
  };
  const total = refundAssignments.length + kycAssignments.length;

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">Welcome back, {user.name.split(" ")[0]}</h1>
        <p className="mt-1 text-sm text-slate-500">Your internal tools and open assignments.</p>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Tools</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow"
            >
              <h3 className="font-medium">{t.name}</h3>
              <p className="mt-1 text-sm text-slate-500">{t.description}</p>
              {toolStats[t.href] && <p className="mt-3 text-xs text-slate-500">{toolStats[t.href]}</p>}
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">My assignments ({total})</h2>
        {total === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
            Nothing needs your attention right now.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Details</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Action item</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {refundAssignments.map((r) => {
                  const item = actionItemFor(user, r)!;
                  return (
                    <tr key={r.id}>
                      <td className="px-4 py-3">
                        <div className="text-xs text-slate-500">Refund</div>
                        <Link href={`/refunds/${r.id}`} className="font-mono text-indigo-600 hover:underline">{r.id}</Link>
                      </td>
                      <td className="px-4 py-3">{r.customer_name}</td>
                      <td className="px-4 py-3 tabular-nums">{formatCents(r.amount_cents, r.currency)}</td>
                      <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                      <td className="px-4 py-3">
                        <RefundActions
                          refundId={r.id}
                          version={r.version}
                          idempotencyKey={randomUUID()}
                          label={item.label}
                          intents={item.intents}
                          amountLabel={formatCents(r.amount_cents, r.currency)}
                        />
                      </td>
                    </tr>
                  );
                })}
                {kycAssignments.map((c) => {
                  const item = kycActionItemFor(user, c)!;
                  const sla = slaState(c);
                  return (
                    <tr key={c.id}>
                      <td className="px-4 py-3">
                        <div className="text-xs text-slate-500">KYC case</div>
                        <Link href={`/kyc/${c.id}`} className="font-mono text-indigo-600 hover:underline">{c.id}</Link>
                      </td>
                      <td className="px-4 py-3">{c.customerName}</td>
                      <td className="px-4 py-3">
                        <RiskBadge risk={c.riskLevel} />
                        {sla && (
                          <div className={`mt-1 text-xs ${sla.overdue ? "font-medium text-red-700" : "text-slate-500"}`}>{sla.label}</div>
                        )}
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                      <td className="px-4 py-3">
                        <KycActions caseId={c.id} version={c.version} label={item.label} intents={item.intents} compact />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
