import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Enables forbidden() so denied pages respond with HTTP 403.
  experimental: { authInterrupts: true },
};

export default nextConfig;
