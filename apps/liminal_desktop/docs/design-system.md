# Liminal desktop design system

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

1. **Screens compose patterns** — avoid raw `BoxDecoration` in `lib/ui/screens/`.
2. **Use `LiminalButton`** instead of ad-hoc `FilledButton` / `OutlinedButton` in chrome.
3. **Use `LiminalListRow`** for navigable lists (hub, integrations).
4. **Use `LiminalSection` + `LiminalCard`** for titled settings/hub blocks.
5. **Persona shells** — `PersonaShellStyle` + `ChatComposerShell` read `PersonaUiTheme.shell` and `inputDock`.

## Persona shells (desktop)

| Shell | Background | App bar | Composer |
|-------|------------|---------|----------|
| `hud` | Grid + glow | Accent border | Bottom bar |
| `terminal` | Scanlines | Green accent border | Bottom bar |
| `studio` | Gradient | Light / centered | Floating card |
| `minimal` | Solid | Transparent | Minimal border |

Set via persona `ui_theme.json` → `shell` and `inputDock` fields.
