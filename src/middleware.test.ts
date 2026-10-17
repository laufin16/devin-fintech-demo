import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "./middleware";

const req = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(`http://localhost:3000${path}`, init);

describe("middleware", () => {
  it("lets the login page and login endpoint through without a session", () => {
    expect(middleware(req("/login")).status).toBe(200);
    expect(middleware(req("/api/auth/login", { method: "POST" })).status).toBe(200);
  });

  it("rejects server-action calls without a session, even on public paths", () => {
    const res = middleware(req("/login", { method: "POST", headers: { "next-action": "abc123" } }));
    expect(res.status).toBe(401);
  });

  it("passes server-action calls with a session cookie to server-side validation", () => {
    const res = middleware(req("/refunds/r1", { method: "POST", headers: { "next-action": "abc123", cookie: "session=x" } }));
    expect(res.status).toBe(200);
  });

  it("redirects pages and 401s API routes without a session", () => {
    const page = middleware(req("/refunds?status=pending"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("http://localhost:3000/login?next=%2Frefunds%3Fstatus%3Dpending");
    expect(middleware(req("/api/refunds")).status).toBe(401);
  });
});
