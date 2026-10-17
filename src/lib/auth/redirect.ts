// Only same-origin relative paths are allowed as post-login destinations.
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) return "/";
  // Browsers treat "\" like "/" (so "/\evil.com" is protocol-relative); control chars can smuggle the same.
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return "/";
  if (next === "/login" || next.startsWith("/login?") || next.startsWith("/login/")) return "/";
  return next;
}
