import { readCacheStats } from "../packages/core/dist/cache_telemetry.js";
const stats = await readCacheStats(process.argv[2]);
const percent = value => value === null ? "unreported" : `${(value * 100).toFixed(1)}%`;
console.table([...[['Measured window',stats.agent],['Last 15 agent responses',stats.last15],['Last 50 agent responses',stats.last50]].map(([window,s])=>({window,responses:s.requests,cachedTokens:s.cachedTokens,inputTokens:s.inputTokens,tokenHitRate:percent(s.cacheHitRate),requestsWithHits:percent(s.requestHitRate),coverage:percent(s.coverage)}))]);
console.table(Object.entries(stats.byProvider).map(([provider,s])=>({provider,responses:s.requests,tokenHitRate:percent(s.cacheHitRate),coverage:percent(s.coverage)})));
console.log('Up to 5,000 measured responses. Unknown cache usage is excluded from hit-rate calculations; coverage shows reporting completeness.');
