import { describe, expect, it } from "vitest";
import { safeNextPath } from "./redirect";

describe("safeNextPath", () => {
  it("keeps same-origin relative paths", () => {
    expect(safeNextPath("/refunds/rf_1001")).toBe("/refunds/rf_1001");
    expect(safeNextPath("/refunds?status=pending")).toBe("/refunds?status=pending");
  });

  it.each([null, undefined, 42, "", "refunds", "https://evil.com", "//evil.com", "/\\evil.com", "/\\/evil.com", "/\tevil", "/login", "/login?next=/"])(
    "rejects %j",
    (next) => {
      expect(safeNextPath(next)).toBe("/");
    },
  );
});
