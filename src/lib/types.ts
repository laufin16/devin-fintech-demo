export type Role = "approver" | "admin";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export type RefundStatus = "pending" | "approved" | "rejected" | "processed";

export type KycStatus = "pending" | "in_review" | "needs_info" | "escalated" | "approved" | "rejected";
export type RiskLevel = "low" | "medium" | "high";
