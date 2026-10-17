import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_PASSWORD } from "@/lib/db/seed";

let POST: (req: NextRequest) => Promise<Response>;
beforeAll(async () => {
  process.env.DATABASE_PATH = ":memory:";
  ({ POST } = await import("./route"));
});

const login = (fields: Record<string, string>, origin = "http://localhost:3000") =>
  POST(
    new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { origin, host: "localhost:3000", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    }),
  );

describe("POST /api/auth/login", () => {
  it("rejects cross-origin requests without touching credentials", async () => {
    const res = await login({ email: "ava@acme.dev", password: DEMO_PASSWORD }, "https://evil.example");
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("sets the session cookie and redirects to a safe next path", async () => {
    const res = await login({ email: "ava@acme.dev", password: DEMO_PASSWORD, next: "/refunds?status=pending" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/refunds?status=pending");
    expect(res.headers.get("set-cookie")).toMatch(/^session=.+HttpOnly/i);
  });

  it("ignores unsafe next paths", async () => {
    const res = await login({ email: "ben@acme.dev", password: DEMO_PASSWORD, next: "//evil.example" });
    expect(res.headers.get("location")).toBe("/");
  });

  it("redirects back to login with an error on bad credentials", async () => {
    const res = await login({ email: "ava@acme.dev", password: "wrong", next: "/audit" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login?next=%2Faudit&error=invalid");
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
