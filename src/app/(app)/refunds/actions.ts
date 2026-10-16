"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { requireActionContext } from "@/lib/auth/current";
import { AppError } from "@/lib/errors";
import { decideRefund, processRefund } from "@/lib/refunds";

export interface RefundActionState {
  error?: string;
  message?: string;
}

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
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }

  revalidatePath("/", "layout");
  return { message };
}
