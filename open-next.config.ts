import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// OpenNext → Cloudflare Workers adapter. Default config: no ISR/edge-cache
// needs (all state lives in Supabase). Deployed at marked.sundaysuite.app.
export default defineCloudflareConfig();
