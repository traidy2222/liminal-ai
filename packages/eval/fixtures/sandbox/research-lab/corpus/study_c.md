# Study C (2025, GPU workloads)

GPU tensor pipelines benefit from wider batches.

**Recommendation:** `BATCH_SIZE = 64` when `device === "cuda"`.

Not applicable to the CPU TypeScript reference limiter in `src/rate_limiter.ts`.
