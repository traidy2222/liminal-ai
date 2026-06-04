# Liminal Desktop (Flutter + liminald)

Native desktop shell for the Liminal harness. The UI is **Flutter** (Skia/Impeller — no embedded browser). The agent engine runs in **`liminald`**, a bundled Node sidecar that reuses `@liminal/core` + `@liminal/tools` over a token-gated loopback WebSocket defined in `@liminal/protocol`.

## Prerequisites

1. **Node 20+** — build and run the sidecar from the monorepo root.
2. **Flutter 3.22+** — [install Flutter](https://docs.flutter.dev/get-started/install) and ensure `flutter` is on your `PATH`.
3. **API key** — root `.env` with `AGENT_API_KEY` (same as web/TUI).

## One-time setup

From the **monorepo root**:

```bash
npm run build:sidecar
cd apps/liminal_desktop
flutter create . --project-name liminal_desktop
flutter pub get
```

`flutter create` adds `windows/`, `macos/`, `linux/` runners. It is safe to re-run; it will not overwrite `lib/`.

## Release builds (local)

| OS | Build | Package for GitHub |
|----|--------|-------------------|
| **Windows** | `npm run desktop:build:windows` | `npm run desktop:package:windows` |
| **macOS** | `npm run desktop:build:macos` | `npm run desktop:package:macos` |
| **Linux** | `npm run desktop:build:linux` | `npm run desktop:package:linux` |

Optional smoke test (Windows): `npm run desktop:test:windows`.

**Windows** — run `liminal_desktop.exe` from `build/windows/x64/runner/Release/` (not the exe alone).

**macOS** — `build/macos/Build/Products/Release/liminal_desktop.app` (`liminald/` is inside `Contents/MacOS/`).

**Linux** — run `./liminal_desktop` from `build/linux/x64/release/bundle/` (keep `liminald/` beside the binary).

Each build includes **`liminald/repo/`** (portable sidecar + `node_modules`) and **`liminald/bundle.json`** (paths relative to the app binary).

## GitHub Release (all platforms)

From the monorepo root, tag `v<version>-desktop` (e.g. `v0.0.18-desktop`) and push — **Actions → Release Desktop** builds Windows, macOS (arm64), and Linux x64 and uploads:

- `liminal-desktop-windows-x64-v<version>.zip`
- `liminal-desktop-macos-arm64-v<version>.zip`
- `liminal-desktop-linux-x64-v<version>.tar.gz`

Each artifact has a `.sha256` sidecar. Or run the workflow manually on `main`.

**End users:** [GitHub Releases](https://github.com/traidy2222/liminal-ai/releases) → pick your OS, install Node 20+, copy `liminald/repo/.env.example` → `.env`, launch the app.

## Development

From the **monorepo root**, build the sidecar once (required before the desktop app can start):

```bash
npm run build:sidecar
```

**Terminal A** (optional — debug the sidecar alone):

```bash
npm run sidecar:dev
```

**Terminal B** — run the desktop app:

```bash
cd apps/liminal_desktop
flutter run -d windows
```

The UI spawns `liminald` automatically. It resolves the sidecar via:

1. `Release/liminald/bundle.json` (written by `npm run desktop:build:windows`)
2. Walking up from the `.exe` to the monorepo (`packages/sidecar/dist/index.js`)
3. `LIMINAL_REPO_ROOT` / `LIMINALD_SCRIPT` env overrides

You need **Node.js on PATH** and a root **`.env`** with `AGENT_API_KEY`.

### Attach to an existing sidecar

```bash
flutter run --dart-define=LIMINALD_ATTACH=1
```

## Architecture

| Layer | Path | Role |
|--------|------|------|
| Protocol | `packages/protocol` | Typed WS frames, events, commands |
| Sidecar | `packages/sidecar` (`liminald`) | Harness + ChatRegistry + WS server |
| **Shell** | `lib/core/` | `ProtocolClient`, `SidecarLifecycle`, `SessionRegistry`, `chat_reducer` |
| **App state** | `lib/state/app_controller.dart` | Boot, config, chat list, commands (not per-chat UI) |
| **Per-chat** | `lib/state/chat_session_controller.dart` | `ChangeNotifier` + reducer; rebuilds only the active transcript |
| **Routing** | `lib/routing/` | `go_router` redirects: boot → setup → persona → chat |
| **DI** | `lib/app/app_scope.dart` | `provider` — `AppScope.of/watch(context)` |

Handshake file: `~/.liminal/sidecar.json` (port + per-launch token).

### `lib/` layout

```
lib/
  core/           # transport + pure reducer (testable, no Widgets)
  state/          # app shell + per-chat controllers
  routing/        # go_router + route constants
  app/            # LiminalApp, AppScope
  models/         # AppConfig, HarnessSettingsSnapshot
  protocol/       # Dart mirror of @liminal/protocol frames
  sidecar/        # spawn liminald
  transport/      # WebSocket client
  ui/             # screens + widgets
```

## Implemented

- Sidecar spawn + WS connect (`hello` / `sidecar_ready`)
- Multi-chat drawer, send/abort, session reset
- Transcript reducer aligned with web (`think` / `reason` / `plan`, subtasks, turn headers, working state)
- Rich assistant rendering (GFM, HTML embeds, images, video links) — see `docs/concepts/rich-message-rendering.md`
- Image attachments in composer (`send_message.attachments`)
- Sticky auto-scroll
- Provider setup + persona bootstrap + harness Settings tabs (`get_settings` / `update_settings`)
- Tool approval + ask-user surfaces

## Next phases

- Persona `PersonaUiTheme` → Flutter `ThemeData`
- WS reconnect + transcript replay
- OAuth loopback for Google/MCP connectors
- Packaged `liminald` binary per OS (SEA/pkg) + installer signing
