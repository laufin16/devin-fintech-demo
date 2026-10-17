import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import {
  getCase,
  getCaseChecks,
  getCaseDocuments,
  getCaseHistory,
  getCaseNotes,
  isOpen,
  listHelpColleagues,
  listHelpRequests,
  MAX_HELP_NOTE_LENGTH,
  kycActionItemFor,
  kycWaitingText,
  slaState,
} from "@/lib/kyc";
import { formatCents } from "@/lib/money";
import { can } from "@/lib/policy";
import { listRefunds, payoutBlockedReason } from "@/lib/refunds";
import { RiskBadge, StatusBadge } from "@/components/status-badge";
import { KycActions } from "../kyc-actions";
import { HelpRequestForm } from "../help-request";

const CHECK_STYLES = {
  pass: "text-emerald-700",
  review: "text-amber-700",
  fail: "text-red-700",
} as const;

const humanize = (s: string) => s[0].toUpperCase() + s.slice(1).replaceAll("_", " ");

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase text-slate-500">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

export default async function KycCasePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("kyc:view");
  const { id } = await params;
  const db = getDb();

  let kyc;
  try {
    kyc = getCase(db, user, id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const item = kycActionItemFor(user, kyc);
  const sla = slaState(kyc);
  const checks = getCaseChecks(db, user, kyc.id);
  const documents = getCaseDocuments(db, user, kyc.id);
  const notes = getCaseNotes(db, user, kyc.id);
  const history = can(user, "kyc:view_history") ? getCaseHistory(db, user, kyc.id) : [];
  const canAskForHelp = can(user, "kyc:request_help") && isOpen(kyc.status);
  const colleagues = canAskForHelp ? listHelpColleagues(db, user) : [];
  const helpRequests = listHelpRequests(db, user, kyc.id);
  const refunds = can(user, "refund:view") ? listRefunds(db, user, { customerId: kyc.customerId }) : [];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/kyc" className="text-sm text-indigo-600 hover:underline">← KYC Review Queue</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold">{kyc.id}</h1>
          <StatusBadge status={kyc.status} />
          <RiskBadge risk={kyc.riskLevel} />
          {sla && <span className={`text-sm ${sla.overdue ? "font-medium text-red-700" : "text-slate-500"}`}>{sla.label}</span>}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-medium">Identity</h2>
              <span className="text-xs text-slate-500">
                {kyc.pii.masked ? "PII masked. Only admins can see full values." : "Unmasked PII (admin)"}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <Field label="Legal name">{kyc.legalName}</Field>
              <Field label="Date of birth"><span className="font-mono">{kyc.pii.dateOfBirth}</span></Field>
              <Field label="National ID"><span className="font-mono">{kyc.pii.nationalId}</span></Field>
              <Field label="Address">
                <span className={kyc.pii.masked ? "font-mono" : ""}>{kyc.pii.addressLine}</span>, {kyc.pii.city}, {kyc.pii.country}
              </Field>
              <Field label="Assignee">{kyc.assigneeName ?? "Unassigned"}</Field>
              <Field label="Decided by">
                {kyc.decidedByName ? `${kyc.decidedByName} · ${new Date(kyc.decidedAt!).toLocaleString("en-US")}` : "—"}
              </Field>
              <Field label="Opened">{new Date(kyc.createdAt).toLocaleString("en-US")}</Field>
              <Field label="Version">{kyc.version}</Field>
            </dl>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-medium">Checks</h2>
            <ul className="divide-y divide-slate-100 text-sm">
              {checks.map((c) => (
                <li key={c.id} className="flex gap-4 py-2">
                  <span className="w-36 shrink-0 text-slate-700">{humanize(c.kind)}</span>
                  <span className={`w-16 shrink-0 font-medium uppercase ${CHECK_STYLES[c.result]}`}>{c.result}</span>
                  <span className="text-slate-600">{c.detail}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-medium">Documents</h2>
            <ul className="divide-y divide-slate-100 text-sm">
              {documents.map((d) => (
                <li key={d.id} className="flex items-center gap-4 py-2">
                  <span className="w-36 shrink-0 text-slate-700">{humanize(d.kind)}</span>
                  <span className="font-mono text-xs text-slate-500">{d.file_name}</span>
                  <span className={`ml-auto text-xs font-medium ${d.status === "verified" ? "text-emerald-700" : "text-amber-700"}`}>
                    {d.status}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-medium">Action item</h2>
            {item ? (
              <KycActions caseId={kyc.id} version={kyc.version} label={item.label} intents={item.intents} />
            ) : (
              <p className="text-sm text-slate-500">{kycWaitingText(kyc)}</p>
            )}
          </section>

          {(canAskForHelp || helpRequests.length > 0) && (
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-1 font-medium">Ask for help</h2>
              <p className="mb-3 text-xs text-slate-500">Sends a Slack DM with a link to this case. Mocked for the prototype.</p>
              {canAskForHelp && <HelpRequestForm caseId={kyc.id} colleagues={colleagues} maxLength={MAX_HELP_NOTE_LENGTH} />}
              {helpRequests.length > 0 && (
                <ol className="mt-4 space-y-3 text-sm">
                  {helpRequests.map((m) => (
                    <li key={m.id} className="border-l-2 border-[#4A154B]/30 pl-3">
                      <div className="text-xs text-slate-500">
                        {m.senderName} → {m.recipientName} · {new Date(m.createdAt).toLocaleString("en-US")}
                      </div>
                      <div className="whitespace-pre-wrap">{m.text}</div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-medium">Customer</h2>
            <p className="text-sm">{kyc.customerName}</p>
            <p className="text-sm text-slate-500">{kyc.customerEmail}</p>
            <p className="mt-1 font-mono text-xs text-slate-400">{kyc.customerId}</p>
            {can(user, "refund:view") && (
              <div className="mt-4">
                <h3 className="text-xs uppercase text-slate-500">Refunds</h3>
                {refunds.length === 0 ? (
                  <p className="mt-1 text-sm text-slate-500">None</p>
                ) : (
                  <ul className="mt-1 space-y-1.5 text-sm">
                    {refunds.map((r) => (
                      <li key={r.id}>
                        <div className="flex items-center gap-2">
                          <Link href={`/refunds/${r.id}`} className="font-mono text-indigo-600 hover:underline">{r.id}</Link>
                          <span className="tabular-nums">{formatCents(r.amount_cents, r.currency)}</span>
                          <StatusBadge status={r.status} />
                        </div>
                        {payoutBlockedReason(r) && <p className="text-xs text-amber-700">{payoutBlockedReason(r)}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-medium">Notes</h2>
            {notes.length === 0 ? (
              <p className="text-sm text-slate-500">No notes yet.</p>
            ) : (
              <ol className="space-y-3 text-sm">
                {notes.map((n) => (
                  <li key={n.id} className="border-l-2 border-slate-200 pl-3">
                    <div className="whitespace-pre-wrap">{n.body}</div>
                    <div className="text-xs text-slate-500">
                      {humanize(n.kind)} · {n.author_name ?? "system"} · {new Date(n.created_at).toLocaleString("en-US")}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>

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
