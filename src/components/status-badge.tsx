import type { RefundStatus } from "@/lib/types";

const STYLES: Record<RefundStatus, string> = {
  pending: "bg-amber-50 text-amber-800 ring-amber-200",
  approved: "bg-sky-50 text-sky-800 ring-sky-200",
  rejected: "bg-slate-100 text-slate-700 ring-slate-300",
  processed: "bg-emerald-50 text-emerald-800 ring-emerald-200",
};

export function StatusBadge({ status }: { status: RefundStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${STYLES[status]}`}>
      {status}
    </span>
  );
}
