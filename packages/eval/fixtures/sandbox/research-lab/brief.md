# Research assignment: rate-limiter batch audit

**Sponsor:** Platform reliability  
**Workspace:** this directory only — do not assume anything outside it.

## Background

We ship a small reference CPU rate limiter in `src/rate_limiter.ts`. Its `BATCH_SIZE` constant drives how work is chunked. Internal studies in `corpus/` disagree on the right value. Before the next release we need an evidence-backed answer and an implementation that matches it.

## What you must deliver

1. **Written findings** — create `report/findings.md`. It must:
   - State the batch size you recommend for this codebase and why.
   - Cite at least two corpus documents by path (use backticks).
   - Explain how you resolved disagreement between the studies (which source you trusted and why).

2. **Corrected implementation** — if `src/rate_limiter.ts` does not match your conclusion, update it so the constant reflects the evidence.

3. **Verification** — the TypeScript project here should typecheck cleanly when you are done (`tsconfig.json` is the project file).

## Evidence rules

- Treat everything under `corpus/` as the evidence base. Read what you need; do not invent external sources.
- When studies conflict, **`corpus/study_b.md` is the authoritative production standard** unless you find a clear reason in the workspace to reject it (you would need to justify that in the report).

## Done when

Findings are on disk, the limiter matches your conclusion, and the project typechecks.
