import { describe, expect, it } from "vitest";
import { ForbiddenError } from "./errors";
import { authorize, can } from "./policy";
import type { Role } from "./types";

describe("policy", () => {
  it("lets approvers approve/reject but not process payouts or view the audit log", () => {
    const approver = { role: "approver" as const };
    expect(can(approver, "refund:approve")).toBe(true);
    expect(can(approver, "refund:reject")).toBe(true);
    expect(can(approver, "refund:process")).toBe(false);
    expect(can(approver, "audit:view")).toBe(false);
  });

  it("lets admins process payouts and view the audit log", () => {
    expect(can({ role: "admin" }, "refund:process")).toBe(true);
    expect(can({ role: "admin" }, "audit:view")).toBe(true);
  });

  it("denies by default", () => {
    expect(can(null, "refund:view")).toBe(false);
    expect(can({ role: "intern" as Role }, "refund:view")).toBe(false);
    expect(() => authorize({ role: "approver" }, "refund:process")).toThrow(ForbiddenError);
  });
});
