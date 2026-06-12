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
};

export default nextConfig;
