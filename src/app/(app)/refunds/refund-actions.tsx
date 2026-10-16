"use client";

import { useActionState } from "react";
import type { RefundIntent } from "@/lib/refunds";
import { refundAction, type RefundActionState } from "./actions";

const BUTTONS: Record<RefundIntent, { text: string; className: string }> = {
  approve: { text: "Approve", className: "bg-emerald-600 text-white hover:bg-emerald-500" },
  reject: { text: "Reject", className: "border border-red-300 text-red-700 hover:bg-red-50" },
  process: { text: "Issue payout", className: "bg-indigo-600 text-white hover:bg-indigo-500" },
};

export function RefundActions(props: {
  refundId: string;
  version: number;
  idempotencyKey: string;
  label: string;
  intents: RefundIntent[];
  amountLabel: string;
}) {
  const [state, formAction, pending] = useActionState<RefundActionState, FormData>(refundAction, {});
  return (
    <form action={formAction} className="space-y-1.5">
      <input type="hidden" name="refundId" value={props.refundId} />
      <input type="hidden" name="version" value={props.version} />
      <input type="hidden" name="idempotencyKey" value={props.idempotencyKey} />
      <p className="text-xs font-medium text-slate-700">{props.label}</p>
      <div className="flex gap-2">
        {props.intents.map((intent) => (
          <button
            key={intent}
            type="submit"
            name="intent"
            value={intent}
            disabled={pending}
            onClick={(e) => {
              if (intent === "process" && !confirm(`Issue a ${props.amountLabel} refund payout for ${props.refundId}?`)) {
                e.preventDefault();
              }
            }}
            className={`rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-60 ${BUTTONS[intent].className}`}
          >
            {BUTTONS[intent].text}
          </button>
        ))}
      </div>
      {state.error && <p role="alert" className="text-xs text-red-600">{state.error}</p>}
      {state.message && <p className="text-xs text-emerald-700">{state.message}</p>}
    </form>
  );
}
