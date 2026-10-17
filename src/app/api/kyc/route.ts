import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api";
import { getDb } from "@/lib/db";
import { KYC_STATUSES, listCases } from "@/lib/kyc";

export const GET = withAuth(async (req, { user }) => {
  const params = req.nextUrl.searchParams;
  const status = KYC_STATUSES.find((s) => s === params.get("status"));
  const cases = listCases(getDb(), user, { status, assignedToMe: params.get("mine") === "1" });
  return NextResponse.json({ cases });
});
