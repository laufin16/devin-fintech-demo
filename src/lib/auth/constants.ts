export const SESSION_COOKIE = "session";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
// Paths reachable without a session. Everything else requires authentication.
export const PUBLIC_PATHS = ["/login"];
