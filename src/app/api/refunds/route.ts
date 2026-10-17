import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api";
import { getDb } from "@/lib/db";
import { listRefunds } from "@/lib/refunds";
import type { RefundStatus } from "@/lib/types";

const STATUSES: RefundStatus[] = ["pending", "approved", "rejected", "processed"];

export const GET = withAuth(async (req, { user }) => {
  const raw = req.nextUrl.searchParams.get("status");
  const status = STATUSES.find((s) => s === raw);
  return NextResponse.json({ refunds: listRefunds(getDb(), user, { status }) });
});
