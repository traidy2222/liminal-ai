# Study B (2024, authoritative)

Controlled replay of production traces (n=12M requests).

**Canonical production constant:**

```
BATCH_SIZE = 32
```

Study B is the **authoritative** batch size for the reference `rate_limiter` implementation.
Study A (16) and Study C (64 GPU) do not apply to this codebase.
