import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { formatCents } from "@/lib/money";
import { can } from "@/lib/policy";
import { actionItemFor, getRefund, getRefundHistory, getRefundLedgerEntries, payoutBlockedReason } from "@/lib/refunds";
import { StatusBadge } from "@/components/status-badge";
import { RefundActions } from "../refund-actions";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase text-slate-500">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

export default async function RefundDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("refund:view");
  const { id } = await params;
  const db = getDb();

  let refund;
  try {
    refund = getRefund(db, user, id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const item = actionItemFor(user, refund);
  const ledger = getRefundLedgerEntries(db, user, refund);
  const history = can(user, "refund:view_history") ? getRefundHistory(db, user, refund.id) : [];
  const amount = formatCents(refund.amount_cents, refund.currency);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/refunds" className="text-sm text-indigo-600 hover:underline">← Refund dashboard</Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold">{refund.id}</h1>
          <StatusBadge status={refund.status} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="mb-4 font-medium">Refund request</h2>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <Field label="Amount"><span className="text-lg font-semibold tabular-nums">{amount}</span></Field>
            <Field label="Order">{refund.order_ref}</Field>
            <Field label="Reason">{refund.reason}</Field>
            <Field label="Requested">{new Date(refund.created_at).toLocaleString("en-US")}</Field>
            <Field label="Assignee">{refund.assignee_name ?? "Unassigned"}</Field>
            <Field label="Decided by">{refund.decided_by_name ?? "—"}</Field>
            <Field label="Payout issued by">{refund.processed_by_name ?? "—"}</Field>
            <Field label="Version">{refund.version}</Field>
          </dl>
        </section>

        <div className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-medium">Customer</h2>
            <p className="text-sm">{refund.customer_name}</p>
            <p className="text-sm text-slate-500">{refund.customer_email}</p>
            <p className="mt-1 font-mono text-xs text-slate-400">{refund.customer_id}</p>
            <div className="mt-3 flex items-center gap-2 text-sm">
              <span className="text-xs uppercase text-slate-500">KYC</span>
              {refund.kyc_status ? <StatusBadge status={refund.kyc_status} /> : <span className="text-slate-500">None on file</span>}
              {refund.kyc_case_id && can(user, "kyc:view") && (
                <Link href={`/kyc/${refund.kyc_case_id}`} className="text-xs text-indigo-600 hover:underline">
                  {refund.kyc_case_id}
                </Link>
              )}
            </div>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-medium">Action item</h2>
            {item ? (
              <RefundActions
                refundId={refund.id}
                version={refund.version}
                idempotencyKey={randomUUID()}
                label={item.label}
                intents={item.intents}
                amountLabel={amount}
              />
            ) : payoutBlockedReason(refund) ? (
              <p className="text-sm text-amber-700">{payoutBlockedReason(refund)}.</p>
            ) : (
              <p className="text-sm text-slate-500">
                {refund.status === "approved" ? "Awaiting payout by an admin." : "No action needed."}
              </p>
            )}
          </section>
        </div>
      </div>

      {ledger.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-medium">Ledger entries</h2>
          <p className="mb-3 font-mono text-xs text-slate-500">{refund.ledger_txn_id}</p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr><th className="py-2">Account</th><th className="py-2 text-right">Debit</th><th className="py-2 text-right">Credit</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ledger.map((e) => (
                <tr key={e.id}>
                  <td className="py-2">{e.account_name} <span className="font-mono text-xs text-slate-400">{e.account_id}</span></td>
                  <td className="py-2 text-right tabular-nums">{e.amount_cents > 0 ? formatCents(e.amount_cents) : ""}</td>
                  <td className="py-2 text-right tabular-nums">{e.amount_cents < 0 ? formatCents(-e.amount_cents) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {history.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-medium">History</h2>
          <ol className="space-y-3 text-sm">
            {history.map((h) => (
              <li key={h.id} className="border-l-2 border-slate-200 pl-3">
                <div className="font-medium">{h.action}</div>
                <div className="text-xs text-slate-500">
                  {h.actor_name ?? "system"} · {new Date(h.created_at).toLocaleString("en-US")} · request {h.request_id.slice(0, 8)}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
