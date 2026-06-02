# Document engine

The document engine turns a goal into a polished **PPTX, DOCX, or PDF** through a pipeline of
`doc_*` tools that communicate via a shared `DocumentIR` and a manifest in `.agent_artifacts/`.
It's on by default (`AGENT_DOC_ENGINE=1`).

## The pipeline

```text
doc_plan → doc_research_brief → doc_collect_sources → doc_select_assets
  → doc_generate_chart_data → doc_compose_chunk → doc_lint_layout → doc_repair_chunk
  → doc_render_pptx | doc_render_docx | doc_render_pdf → doc_export → doc_quality_report
```

- **`doc_plan`** establishes the outline/sections.
- **Compose / lint / repair** iterate each section against layout rules
  (`doc_repair_chunk`, bounded by `AGENT_DOC_REPAIR_BUDGET`).
- **Render** tools are the *only* ones that emit final binary output — and they enforce the
  quality gate (`AGENT_DOC_QUALITY_MIN`) **before** export.

With `AGENT_DOC_AUTONOMY` (on) the engine can compose a document without explicit per-section
prompts; with `AGENT_DOC_WEB_ASSETS` (on) it can fetch web images for slides/pages.

## Quality &amp; style

The render tools refuse to export below `AGENT_DOC_QUALITY_MIN` (0–100). Style variety across
sections is enforced by `AGENT_DOC_STYLE_DIVERSITY_MIN` so a deck doesn't look monotonous.
`doc_quality_report` summarizes the final score.

## Configuration

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `AGENT_DOC_ENGINE` | on | Register all `doc_*` tools |
| `AGENT_DOC_AUTONOMY` | on | Auto-compose without explicit section prompts |
| `AGENT_DOC_WEB_ASSETS` | on | Fetch web images for slides/pages |
| `AGENT_DOC_QUALITY_MIN` | `90` | Minimum quality score before export |
| `AGENT_DOC_REPAIR_BUDGET` | `4` | Max lint-repair iterations per section |
| `AGENT_DOC_STYLE_DIVERSITY_MIN` | `0.12` | Minimum style variance across sections |

## Example prompt

> "Build a 10-slide investor deck on our Q3 metrics. Pull the numbers from `metrics.csv`,
> chart MRR growth, and export PPTX."

The engine plans sections, generates chart data, composes and lints each slide, repairs any
layout issues, checks the quality gate, and renders the `.pptx` to `.agent_artifacts/`.

Shared modules: `doc_engine.ts` (IR + manifest helpers), `doc_style_memory.ts`. All `doc_*`
tools live in the `document` family — activate it if lazy loading hides it.
