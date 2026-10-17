const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-50 text-amber-800 ring-amber-200",
  approved: "bg-sky-50 text-sky-800 ring-sky-200",
  rejected: "bg-slate-100 text-slate-700 ring-slate-300",
  processed: "bg-emerald-50 text-emerald-800 ring-emerald-200",
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
