# Liminal marketing videos (Remotion)

Programmatic **1080p / 30fps** marketing reels for [Liminal](https://www.vireondynamics.com/liminal) — built with [Remotion](https://www.remotion.dev/). Visual language matches the web UI (`#020408` background, cyan accent `#00d4ff`).

Uses existing repo assets from `assets/` (heroes + `assets/marketing/*.png`).

## Compositions

| ID | ~Length | Purpose |
|----|---------|---------|
| `Liminal-Desktop-Cinematic` | 48s · **60fps** | Flagship website reel — cold open, 3D hero window, real-session trace cascade, capability beat, integrations wall, CTA (`src/cinematic/` design system) |
| `Liminal-Hero-Ambient` | 12s · **60fps** | Seamless background loop for the website hero — aurora + floating desktop window, no text |
| `Liminal-Hero` | 20s | Brand intro + web UI hero + install commands |
| `Liminal-Harness` | 38s | Animated ReAct architecture story (5 beats) |
| `Liminal-Features` | ~22s | Six capability slides (coding, memory, web, agents, approvals, persona) |
| `Liminal-Transparency` | 24s | Black-box chat vs visible tool trace |
| `Liminal-CTA` | 14s | Community Edition + get-started |
| `Liminal-Promo-Full` | ~2 min | Full reel with cross-fades |
| `Liminal-Social-Teaser` | ~34s | Short cut: hero → transparency → CTA |
| `Liminal-Desktop-Hero` | 20s | Desktop brand intro + real capture hero |
| `Liminal-Desktop-Features` | ~22s | Four desktop capability slides from `desktop-manifest.json` |
| `Liminal-Desktop-Transparency` | 24s | Real session tool trace vs black-box chat |
| `Liminal-Desktop-CTA` | 14s | Download desktop CTA |
| `Liminal-Desktop-Promo-Full` | ~2 min | Full desktop reel |
| `Liminal-Desktop-Social-Teaser` | ~34s | Desktop hero → real trace → CTA |

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

**Desktop marketing (recommended):** run `npm run marketing:capture:desktop` first, then render `Liminal-Desktop-Promo-Full`. Compositions load `assets/marketing/desktop-manifest.json` and real `messages.json` traces.

**Web marketing:** `npm run marketing:capture:live` — update `FeatureTour.tsx` `SLIDES` to `marketing/live-*.png` if needed.

## Output

Rendered MP4s land in `assets/marketing/videos/` (gitignored except `.gitkeep`). Wire them into the Vireon site or README as needed.

## Requirements

- Node 22+
- FFmpeg on PATH (Remotion render)
- No API key — purely local React video
