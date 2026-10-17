import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Enables forbidden() / unauthorized() so denied requests respond with HTTP 403 / 401.
  experimental: { authInterrupts: true },
};

export default nextConfig;
