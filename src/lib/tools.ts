import type { Action } from "./policy";

export interface Tool {
  href: string;
  name: string;
  navLabel: string;
  description: string;
  requires: Action;
}

export const TOOLS: Tool[] = [
  {
    href: "/refunds",
    name: "Refund dashboard",
    navLabel: "Refunds",
    description: "Review refund requests, approve or reject them, and issue payouts.",
    requires: "refund:view",
  },
  {
    href: "/audit",
    name: "Audit log",
    navLabel: "Audit log",
    description: "Append-only record of every state change on the platform.",
    requires: "audit:view",
  },
];
