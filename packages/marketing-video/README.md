# Liminal marketing videos (Remotion)

Programmatic **1080p / 30fps** marketing reels for [Liminal](https://www.vireondynamics.com/liminal) — built with [Remotion](https://www.remotion.dev/). Visual language matches the web UI (`#020408` background, cyan accent `#00d4ff`).

Uses existing repo assets from `assets/` (heroes + `assets/marketing/*.png`).

## Compositions

| ID | ~Length | Purpose |
|----|---------|---------|
| `Liminal-Hero` | 20s | Brand intro + web UI hero + install commands |
| `Liminal-Harness` | 38s | Animated ReAct architecture story (5 beats) |
| `Liminal-Features` | ~22s | Six capability slides (coding, memory, web, agents, approvals, persona) |
| `Liminal-Transparency` | 24s | Black-box chat vs visible tool trace |
| `Liminal-CTA` | 14s | Community Edition + get-started |
| `Liminal-Promo-Full` | ~2 min | Full reel with cross-fades |
| `Liminal-Social-Teaser` | ~34s | Short cut: hero → transparency → CTA |

## Quick start

From repo root (after `npm install`):

```bash
# Install Remotion deps for this workspace
npm install -w @liminal/marketing-video

# Open Remotion Studio (preview + scrub timeline)
npm run marketing:video

# Render one composition
npm run marketing:video:render -- Liminal-Hero assets/marketing/videos/liminal-hero.mp4

# Render all compositions to assets/marketing/videos/
npm run marketing:video:render:all
```

From this package:

```bash
cd packages/marketing-video
npm run studio
npm run render -- Liminal-Promo-Full ../../assets/marketing/videos/liminal-promo-full.mp4
```

## Customize

| Area | Files |
|------|--------|
| Colors / copy | `src/theme.ts`, composition files under `src/compositions/` |
| Feature slides | `src/compositions/FeatureTour.tsx` → `SLIDES` |
| Architecture beats | `src/compositions/HarnessExplainer.tsx` → `PHASES` |
| New chapter | Add composition + register in `src/Root.tsx` |

Swap illustrative PNGs for **live captures** when publishing (`npm run marketing:capture:live`) — update `SLIDES` paths to `marketing/live-*.png`.

## Output

Rendered MP4s land in `assets/marketing/videos/` (gitignored except `.gitkeep`). Wire them into the Vireon site or README as needed.

## Requirements

- Node 22+
- FFmpeg on PATH (Remotion render)
- No API key — purely local React video
