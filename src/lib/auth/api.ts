import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { AppError } from "../errors";
import type { User } from "../types";
import { getCurrentUser, getRequestId } from "./current";

type RouteContext<P> = { params: Promise<P> };
type AuthedHandler<P> = (
  req: NextRequest,
  ctx: RouteContext<P> & { user: User; requestId: string },
) => Promise<Response>;

// Wraps every API route handler: 401 without a valid session, AppErrors mapped to their status.
export function withAuth<P extends Record<string, string | string[]> = Record<string, never>>(
  handler: AuthedHandler<P>,
) {
  return async (req: NextRequest, ctx: RouteContext<P>): Promise<Response> => {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    try {
      return await handler(req, { ...ctx, user, requestId: await getRequestId() });
    } catch (err) {
      if (err instanceof AppError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  };
}
