# Optional desktop usage sharing

Liminal desktop usage sharing is **off by default**. Declining does not restrict Community Edition, local models, or your own provider connection. Website cookie consent is separate.

The hub offers a one-time choice. You can change it under **Settings → About & updates**. That panel also lets you delete shared history and stop sharing without creating an account. Deletion requires a working connection; a failed request retains the local random identifier so you can retry.

## What is sent

After consent, the main desktop app creates a random installation identifier in `~/.liminal/usage_preferences.json`. It sends only:

- Schema version, installation identifier, app version and platform.
- `app_open`, `app_ready`, or `conversation_completed`.

No prompts, answers, files, paths, account identifiers, provider names, keys, or model selections enter this payload. The server stores a hash of the identifier and UTC activity dates. Ordinary hosting connection metadata may still be processed by the receiving infrastructure. [Privacy policy](https://www.vireondynamics.com/legal/privacy).

Each milestone is sent at most once per UTC day and is also deduplicated on the server. Requests have a short timeout and a failure backoff; app startup and conversations do not wait for collection. There is no offline activity backlog. Development and marketing capture builds disable reporting by default; tests use private temporary preferences and mock HTTP clients.

## What the numbers mean

The first observed launch is an adoption signal for a participating portable installation. It is not proof of a unique person or an installer execution. Existing users may first opt in on a later release. No past usage is uploaded.

Workspace readiness means the desktop connected to its local harness, not that a model has answered. A completed conversation requires a live user-started turn, answer text, and a turn-end event without an observed error or cancellation. Replayed transcripts and background turns do not count. This is an activity metric, not proof of a correct answer or completed real-world task.

Active/returning metrics use conversation days. Daily records are kept for 90 days; inactive installations are removed by daily maintenance after 90 days. Separate devices, deleted preferences, offline use and opt-outs affect coverage. Browser download clicks are measured separately and are not secretly linked to the desktop identifier.

## Developer checks

```
cd apps/liminal_desktop
flutter test test/usage_analytics_test.dart
```

The fixed client contract is in `lib/core/usage/usage_analytics.dart`. Keep it content-free and consent-gated. The Vireon website repository owns the collector, storage migration, retention job, privacy policy and private admin report. Never embed a database/service key in the client.
