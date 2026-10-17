const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-50 text-amber-800 ring-amber-200",
  approved: "bg-sky-50 text-sky-800 ring-sky-200",
  rejected: "bg-slate-100 text-slate-700 ring-slate-300",
  processed: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  in_review: "bg-indigo-50 text-indigo-800 ring-indigo-200",
  needs_info: "bg-orange-50 text-orange-800 ring-orange-200",
  escalated: "bg-fuchsia-50 text-fuchsia-800 ring-fuchsia-200",
};

const RISK_STYLES: Record<string, string> = {
  low: "bg-slate-50 text-slate-700 ring-slate-200",
  medium: "bg-amber-50 text-amber-800 ring-amber-200",
  high: "bg-red-50 text-red-700 ring-red-200",
};

const FALLBACK = "bg-slate-50 text-slate-700 ring-slate-200";

function Badge({ text, className }: { text: string; className: string }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${className}`}>
      {text}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge text={status.replace("_", " ")} className={STATUS_STYLES[status] ?? FALLBACK} />;
}

export function RiskBadge({ risk }: { risk: string }) {
  return <Badge text={`${risk} risk`} className={RISK_STYLES[risk] ?? FALLBACK} />;
}
