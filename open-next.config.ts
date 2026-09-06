import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// OpenNext → Cloudflare Workers adapter. Deployed at basar.sundaysuite.app.
//
// WHY NOT THE DEFAULT: `defineCloudflareConfig()` with no options leaves
// `incrementalCache: "dummy"`, which means the prerendered pages Next produces
// at build time (`/`, `/host/new`, `/host/login`, `/host/auksjon/new`,
// `/_not-found`) are never actually served from the cache — the Worker re-runs
// a full React SSR render on EVERY request for pages whose HTML is already
// sitting on disk. On Workers Free that CPU-per-request adds up fast; the
// build writes `.open-next/cache/*`, but nothing uploads or reads it.
//
// `staticAssetsIncrementalCache` serves those entries out of the Workers static
// assets bundle (under `cdn-cgi/_next_cache/`, worker-only, not publicly
// fetchable), and `enableCacheInterception` lets the routing layer answer from
// that cache BEFORE booting the Next server — turning a CPU-heavy render into
// an assets fetch.
//
// ⚠️ The static-assets cache is READ-ONLY (its `set`/`delete` log an error and
// do nothing) and it cannot serve the composable ("use cache") cache. That is
// safe here precisely because this app has no time-based revalidation: no route
// exports `revalidate`, nothing calls `unstable_cache`/`revalidateTag`, and
// `cacheComponents` is off — every prerendered page is a fully static shell
// whose live data arrives client-side from Supabase (anon client + SECURITY
// DEFINER RPCs). If a future page ever introduces ISR, its cache entry would be
// frozen at build time forever; move that route off prerendering (or switch to
// the KV/R2 cache) at the same time.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
});
