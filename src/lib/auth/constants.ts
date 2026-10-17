export const SESSION_COOKIE = "session";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
// last_seen_at is refreshed at most this often, so idle tracking doesn't write on every request.
export const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
// Paths reachable without a session. Everything else requires authentication.
// Server-action calls are never public (middleware rejects them without a session cookie).
export const PUBLIC_PATHS = ["/login", "/api/auth/login"];
