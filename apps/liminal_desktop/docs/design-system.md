# Liminal desktop design system

## Workspace direction

The desktop and web workspace share a quiet slate/iris identity. Space Grotesk
is bundled for display headings, Inter/system sans is used for reading, and
the existing monospace families remain for code and utility labels. Font
licenses live beside the assets; the new display font needs no network request.

The default palette is iris `#B5A2F5`, mist `#8CBFC5`, slate `#191C27`, muted
text `#A3A8BA`, success `#91C7AD`, and warning `#E4BB83`. Persona palettes still
provide the semantic colors. The shared mark is two offset doorframes, drawn
as native paths/SVG. It replaces the glowing orb in workspace branding.

Desktop chat navigation stays visible at 1100px and wider; smaller windows use
the drawer. Search filters conversation titles and workspace paths. Starting
prompts populate a reviewable draft, preserving attachments, and never send
automatically. The transcript and floating composer have bounded reading widths.
Web HUD/studio workspaces use the matching layout with an optional activity
panel; terminal and minimal personas retain their dedicated shells.

For focused native validation, run `flutter test test/workspace_design_test.dart`.
Set `LIMINAL_CAPTURE_DESIGN=1` to capture the real shared widgets at desktop and
narrow widths into the repository's `.agent_artifacts/` directory. These are
fixture captures, not recordings of live model sessions.

Flutter UI kit under `lib/ui/design_system/`. Import everything via:

```dart
import '../design_system/liminal_design_system.dart';
```

## Layers

| Layer | Path | Use for |
|-------|------|---------|
| **Tokens** | `tokens/` | Elevation, motion, typography helpers |
| **Primitives** | `primitives/` | Button, Card, Badge, Surface, IconButton, Interactive |
| **Patterns** | `patterns/` | Section, Sheet, ListRow, EmptyState, SearchField |
| **Shells** | `shells/` | Persona shell chrome + composer dock layouts |

Theme colors/fonts still come from `LiminalTheme.of(context)` (`lib/ui/theme/`).

## Rules

1. **Screens compose patterns** — keep surface styling in shared components or a dedicated, testable view such as `screens/hub/workspace_hub.dart`.
2. **Use `LiminalButton`** instead of ad-hoc `FilledButton` / `OutlinedButton` in chrome.
3. **Use `LiminalListRow`** for compact navigable lists; the hub uses conversation cards with workspace context and a separate action menu.
4. **Use `LiminalSection` + `LiminalCard`** for titled settings blocks. The workspace home has its own page hierarchy and shared card treatments.
5. **Persona shells** — `PersonaShellStyle` + `ChatComposerShell` read `PersonaUiTheme.shell` and `inputDock`.

## Persona shells (desktop)

| Shell | Background | App bar | Composer |
|-------|------------|---------|----------|
| `hud` | Solid slate | Neutral workspace | Bottom bar |
| `terminal` | Scanlines | Green accent border | Bottom bar |
| `studio` | Solid slate | Neutral workspace | Floating card |
| `minimal` | Solid | Transparent | Minimal border |

Set via persona `ui_theme.json` → `shell` and `inputDock` fields.

## Workspace home

The hub uses a neutral slate canvas and surfaces, with the saved persona's name
and accent retained. A pale primary action panel expands the threshold mark into
an architectural motif. Space Grotesk headings, Inter body copy, and restrained
monospace labels establish the hierarchy without ambient glow.

Overview shows six recent conversations. The conversation library provides title
and workspace search, a working-only filter, and pages of twelve cards. Mission
control has a full-width editor whose draft survives hub navigation. Connected
tools and inbox actions use the existing controller routes and callbacks.

The rail becomes a scrollable drawer below 1050 logical pixels. Interactive
surfaces retain keyboard focus rings and respect reduced motion. Run
`flutter test test/workspace_hub_test.dart` for navigation and responsive checks;
`LIMINAL_CAPTURE_DESIGN=1` also saves review images under `.agent_artifacts/`.

## Settings and supporting pages

Settings use stable categories: Model & provider, Preferences, Memory,
Permissions, Advanced, Account, and About & updates (desktop). Connected tools
has its own categorized desktop page and a category inside web settings.
Everyday controls use plain-language labels. Other controls remain available
through Show advanced options and search; no runtime setting is removed.
Credentials, model presets, technical diagnostics, and connection options use
progressive disclosure. Search covers advanced controls regardless of category.

Presentation mappings live in `models/settings_presentation.dart` and web
`settings/settingsPresentation.ts`. Keep the two policies aligned. They do not
change harness schema, values, environment locks, or save semantics. Desktop
controls apply immediately; the web modal retains drafts until Save changes.

Non-terminal persona chrome uses shared neutral surfaces and typography across
chat, hub, settings, connections, setup, and errors; persona accent, name, shell,
and composer preferences remain available. Terminal retains its specialized theme.

Run `flutter test test/settings_streamline_test.dart` for category disclosure,
search, saving, and narrow managed-model errors. Browser review should use the
full real settings metadata with intercepted APIs, including both own-key and
managed accounts, so validation does not change a user's live settings.

## Provider model selection

OpenRouter uses the live public catalog, searched by model name or ID, instead
of bundled presets. Selecting a model changes the main model only. Managed
OpenRouter and BYOK use the same individual catalog; other managed providers
retain their provider-filtered catalog. Automatic connection mode shows the
active provider form rather than duplicating managed and BYOK controls.

Use one model for everything is an explicit runtime policy, off by default.
It follows the selected model for chat, background completions, and vision;
separate embeddings and hosted speech are disabled. Memory keeps keyword search.
Router entries such as Auto, Free, Fusion, Body Builder and Pareto are excluded
from this mode. A text-only model does not gain vision support; requests never
silently switch to another model. Disabling the policy restores saved specialist
settings. The catalog communicates tool and vision capabilities before selection.
