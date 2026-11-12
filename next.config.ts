import path from "node:path";
import type { NextConfig } from "next";

// Initialize the OpenNext Cloudflare dev shim so `getCloudflareContext()` works
// during `next dev`. No-op in production builds.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the workspace root: a stray parent lockfile would otherwise be
  // auto-selected and break output tracing / env resolution.
  turbopack: {
    root: path.join(__dirname),
  },
  // Load-bearing, see docs/DECISIONS.md ADR-001: `typescript` is the TS 6 compat
  // package (no `bin.tsc`), so Next must type-check via the in-process API.
  experimental: {
    useTypeScriptCli: false,
  },
};

export default nextConfig;
