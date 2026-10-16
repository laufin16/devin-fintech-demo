export type Role = "approver" | "admin";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export type RefundStatus = "pending" | "approved" | "rejected" | "processed";
