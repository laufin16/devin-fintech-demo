"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { ActionState } from "@/lib/action-state";
import type { KycIntent } from "@/lib/kyc";
import { kycAction } from "./actions";

const BUTTONS: Record<KycIntent, { text: string; className: string }> = {
  claim: { text: "Claim", className: "bg-indigo-600 text-white hover:bg-indigo-500" },
  release: { text: "Release", className: "border border-slate-300 text-slate-700 hover:bg-slate-50" },
  approve: { text: "Approve", className: "bg-emerald-600 text-white hover:bg-emerald-500" },
  reject: { text: "Reject", className: "border border-red-300 text-red-700 hover:bg-red-50" },
  request_info: { text: "Request info", className: "border border-orange-300 text-orange-800 hover:bg-orange-50" },
  escalate: { text: "Escalate", className: "border border-fuchsia-300 text-fuchsia-800 hover:bg-fuchsia-50" },
};

const NEEDS_REASON: KycIntent[] = ["request_info", "escalate", "approve", "reject"];

// `compact` (lists): only claim/release inline; decisions need a reason, so they link to the case page.
export function KycActions(props: {
  caseId: string;
  version: number;
  label: string;
  intents: KycIntent[];
  compact?: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(kycAction, {});
  const quick = props.intents.filter((i) => !NEEDS_REASON.includes(i));
  const withReason = props.intents.filter((i) => NEEDS_REASON.includes(i));
  const claimText = props.label.startsWith("Resume") ? "Resume review" : BUTTONS.claim.text;

  const button = (intent: KycIntent) => (
    <button
      key={intent}
      type="submit"
      name="intent"
      value={intent}
      disabled={pending}
      className={`rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-60 ${BUTTONS[intent].className}`}
    >
      {intent === "claim" ? claimText : BUTTONS[intent].text}
    </button>
  );
  const hidden = (
    <>
      <input type="hidden" name="caseId" value={props.caseId} />
      <input type="hidden" name="version" value={props.version} />
    </>
  );

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-slate-700">{props.label}</p>
      {withReason.length > 0 &&
        (props.compact ? (
          <Link
            href={`/kyc/${props.caseId}`}
            className="inline-flex rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500"
          >
            Open case to decide
          </Link>
        ) : (
          <form action={formAction} className="space-y-2">
            {hidden}
            <label className="block text-xs text-slate-500" htmlFor={`reason-${props.caseId}`}>
              Reason (required, kept in the case notes)
            </label>
            <textarea
              id={`reason-${props.caseId}`}
              name="reason"
              required
              maxLength={1000}
              rows={3}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
            />
            <div className="flex flex-wrap gap-2">{withReason.map(button)}</div>
          </form>
        ))}
      {quick.length > 0 && (
        <form action={formAction} className="flex gap-2">
          {hidden}
          {quick.map(button)}
        </form>
      )}
      {state.error && <p role="alert" className="text-xs text-red-600">{state.error}</p>}
      {state.message && <p className="text-xs text-emerald-700">{state.message}</p>}
    </div>
  );
}
