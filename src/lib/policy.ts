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
] as const;

export type Action = (typeof ACTIONS)[number];

const POLICY: Record<Role, readonly Action[]> = {
  approver: ["tools:view", "refund:view", "refund:view_history", "refund:approve", "refund:reject"],
  admin: [
    "tools:view",
    "refund:view",
    "refund:view_history",
    "refund:approve",
    "refund:reject",
    "refund:process",
    "audit:view",
  ],
};

export function can(user: Pick<User, "role"> | null | undefined, action: Action): boolean {
  if (!user) return false;
  return POLICY[user.role]?.includes(action) ?? false;
}

export function authorize(user: Pick<User, "role"> | null | undefined, action: Action): void {
  if (!can(user, action)) throw new ForbiddenError(`Not permitted: ${action}`);
}
