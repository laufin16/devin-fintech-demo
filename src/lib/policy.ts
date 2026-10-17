// Central mock authorization policy. Every authorization decision in the app goes through
// `can` / `authorize`. Anything not explicitly granted here is denied.
import { ForbiddenError } from "./errors";
import type { Role, User } from "./types";

export const ACTIONS = [
  "tools:view",
  "refund:view",
  "refund:view_history",
  "refund:approve",
  "refund:reject",
  "refund:process",
  "audit:view",
  "kyc:view",
  "kyc:view_history",
  "kyc:claim",
  "kyc:request_info",
  "kyc:escalate",
  "kyc:approve",
  "kyc:reject",
  "kyc:decide_escalated",
  "kyc:view_pii",
  "kyc:request_help",
] as const;

export type Action = (typeof ACTIONS)[number];

const KYC_REVIEW: readonly Action[] = [
  "kyc:view",
  "kyc:view_history",
  "kyc:claim",
  "kyc:request_info",
  "kyc:escalate",
  "kyc:approve",
  "kyc:reject",
  "kyc:request_help",
];

const POLICY: Record<Role, readonly Action[]> = {
  approver: ["tools:view", "refund:view", "refund:view_history", "refund:approve", "refund:reject", ...KYC_REVIEW],
  admin: [
    "tools:view",
    "refund:view",
    "refund:view_history",
    "refund:approve",
    "refund:reject",
    "refund:process",
    "audit:view",
    ...KYC_REVIEW,
    // Escalated KYC cases are decided by admins; only admins see unmasked PII (AGENTS.md).
    "kyc:decide_escalated",
    "kyc:view_pii",
  ],
};

export function can(user: Pick<User, "role"> | null | undefined, action: Action): boolean {
  if (!user) return false;
  return POLICY[user.role]?.includes(action) ?? false;
}

export function authorize(user: Pick<User, "role"> | null | undefined, action: Action): void {
  if (!can(user, action)) throw new ForbiddenError(`Not permitted: ${action}`);
}
