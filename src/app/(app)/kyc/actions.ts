"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { requireActionContext } from "@/lib/auth/current";
import { actionErrorState, type ActionState } from "@/lib/action-state";
import { claimCase, decideCase, escalateCase, releaseCase, requestInfo, requestKycHelp } from "@/lib/kyc";

export async function kycAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, requestId } = await requireActionContext();
  const input = {
    caseId: String(formData.get("caseId") ?? ""),
    expectedVersion: Number(formData.get("version")),
    requestId,
  };
  const reason = String(formData.get("reason") ?? "");
  const intent = formData.get("intent");
  const db = getDb();

  let message: string;
  try {
    switch (intent) {
      case "claim":
        claimCase(db, user, input);
        message = "Case claimed";
        break;
      case "release":
        releaseCase(db, user, input);
        message = "Case released back to the queue";
        break;
      case "request_info":
        requestInfo(db, user, { ...input, reason });
        message = "Requested more information";
        break;
      case "escalate":
        escalateCase(db, user, { ...input, reason });
        message = "Case escalated to admins";
        break;
      case "approve":
      case "reject":
        decideCase(db, user, { ...input, decision: intent, reason });
        message = intent === "approve" ? "KYC approved" : "KYC rejected";
        break;
      default:
        return { error: "Unknown action" };
    }
  } catch (err) {
    return actionErrorState(err, requestId, "kycAction");
  }

  revalidatePath("/", "layout");
  return { message };
}

export async function requestHelpAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, requestId } = await requireActionContext();
  let recipientName: string;
  try {
    recipientName = requestKycHelp(getDb(), user, {
      caseId: String(formData.get("caseId") ?? ""),
      recipientId: String(formData.get("recipientId") ?? ""),
      note: String(formData.get("note") ?? ""),
      requestId,
    }).recipientName;
  } catch (err) {
    return actionErrorState(err, requestId, "requestHelpAction");
  }
  revalidatePath("/kyc", "layout");
  return { message: `Slack message sent to ${recipientName} (mock)` };
}
