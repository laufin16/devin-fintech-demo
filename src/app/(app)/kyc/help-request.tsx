"use client";

import { useActionState, useEffect, useRef } from "react";
import type { ActionState } from "@/lib/action-state";
import type { Colleague } from "@/lib/kyc";
import { requestHelpAction } from "./actions";

export function HelpRequestForm({ caseId, colleagues, maxLength }: { caseId: string; colleagues: Colleague[]; maxLength: number }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(requestHelpAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.message) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <input type="hidden" name="caseId" value={caseId} />
      <label className="block text-xs text-slate-500" htmlFor="help-recipient">Coworker</label>
      <select
        id="help-recipient"
        name="recipientId"
        required
        defaultValue=""
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
      >
        <option value="">Choose a coworker</option>
        {colleagues.map((c) => (
          <option key={c.id} value={c.id}>{c.name} ({c.role})</option>
        ))}
      </select>
      <label className="block text-xs text-slate-500" htmlFor="help-note">What do you need help with? (no PII)</label>
      <textarea
        id="help-note"
        name="note"
        required
        maxLength={maxLength}
        rows={3}
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-[#4A154B] px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
      >
        Send Slack message
      </button>
      {state.error && <p role="alert" className="text-xs text-red-600">{state.error}</p>}
      {state.message && <p className="text-xs text-emerald-700">{state.message}</p>}
    </form>
  );
}
