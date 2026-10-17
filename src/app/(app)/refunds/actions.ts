"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { requireActionContext } from "@/lib/auth/current";
import { actionErrorState, type ActionState } from "@/lib/action-state";
import { decideRefund, processRefund } from "@/lib/refunds";

export type RefundActionState = ActionState;

export async function refundAction(_prev: RefundActionState, formData: FormData): Promise<RefundActionState> {
  const { user, requestId } = await requireActionContext();
  const refundId = String(formData.get("refundId") ?? "");
  const intent = formData.get("intent");
  const expectedVersion = Number(formData.get("version"));
  const db = getDb();

  let message: string;
  try {
    if (intent === "approve" || intent === "reject") {
      decideRefund(db, user, { refundId, decision: intent, expectedVersion, requestId });
      message = intent === "approve" ? "Refund approved" : "Refund rejected";
    } else if (intent === "process") {
      const result = processRefund(db, user, {
        refundId,
        expectedVersion,
        idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
        requestId,
      });
      message = result.replayed ? "Payout already issued (duplicate submission ignored)" : "Refund payout issued";
    } else {
      return { error: "Unknown action" };
    }
  } catch (err) {
    return actionErrorState(err, requestId, "refundAction");
  }

  revalidatePath("/", "layout");
  return { message };
}
