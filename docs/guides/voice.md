# Voice (TTS &amp; dictation)

The web UI can **speak its replies** (text-to-speech) and **listen** (dictation/transcription),
so you can drive the agent hands-free. Both are sidecar model calls you control via env.

## Dictation (speech → text)

Record in the browser and send the clip for transcription:

- `POST /api/audio/upload` persists the clip under the active chat and returns an
  `attachmentId` (audio is sent as a base64 data URL — `audio/webm`, etc.).
- `POST /api/transcribe` runs ASR on that id and returns the text, duration, language, and
  cost.

In the agent loop, `transcribe_audio` (the `audio` family) does the same server-side.

### Where dictation gets transcribed (server model vs browser)

By default (`AGENT_DICTATION_WEB_SPEECH=0`) dictation records audio and transcribes it
**server-side** with your `AGENT_TRANSCRIBE_MODEL` — so speech never leaves for the browser
vendor's cloud (Chrome's recognizer sends audio to Google). Set `AGENT_DICTATION_WEB_SPEECH=1`
to use the browser's built-in Web Speech API for an instant live preview while you talk
(Chrome/Edge); the recorded audio is still sent to the server model for the final transcript.

The default ASR model is **`nvidia/parakeet-tdt-0.6b-v3`** ($0.0015/min, English + EU). For
99-language coverage set `AGENT_TRANSCRIBE_MODEL=openai/whisper-large-v3-turbo`; for Chinese
dialects, `qwen/qwen3-asr-flash`.

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `AGENT_TRANSCRIBE_ENABLED` | `1` | Master switch for transcription |
| `AGENT_TRANSCRIBE_MODEL` | `nvidia/parakeet-tdt-0.6b-v3` | ASR model slug |
| `AGENT_TRANSCRIBE_API_KEY` | — | ASR key (falls back to `AGENT_API_KEY` / `OPENROUTER_API_KEY`) |
| `AGENT_TRANSCRIBE_MAX_BYTES` | `26214400` | Per-clip size limit (25 MB) |
| `AGENT_DICTATION_WEB_SPEECH` | `0` | `1` = browser live preview; `0` = server model only |
| `AGENT_DICTATION_AUDIO_CUE` | `0` | Play a start/stop cue in the UI |

## Text-to-speech (text → speech)

- `POST /api/tts` synthesizes speech (segmented for long text) and returns clip ids + cost.
- `GET /api/tts/clip/:clipId` streams a clip's audio bytes.

Text is sanitized and capped per call, with duplicate-clip suppression and a per-turn speech
budget so the agent doesn't read back everything. The `speak` tool exposes TTS in the loop.

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `AGENT_TTS_ENABLED` | off | Master switch for TTS |
| `AGENT_TTS_VOICE` | `af_sky` | Default voice |

## Managed inference

On Pro, voice sidecars can route through Vireon-managed inference along with chat — any
OpenRouter TTS model slug you choose in Settings (e.g. `openai/gpt-4o-mini-tts-2025-12-15` or
`hexgrad/kokoro-82m`) is forwarded on `audio/speech`; the chat model allowlist does not block
TTS. No separate key needed. See [Managed inference](./managed-inference.md).

## Desktop (Flutter + liminald)

The native desktop app uses the **same HTTP paths** on the sidecar loopback server
(`127.0.0.1`, token-gated):

- `POST /api/audio/upload?token=…&chatId=…`
- `POST /api/transcribe?token=…&chatId=…`
- `GET /api/tts/clip/:clipId?token=…&chatId=…`

Dictation flow:

1. Arm the **mic** in the composer (session stays on across turns).
2. VAD detects end-of-speech → clip uploads → server ASR (`AGENT_TRANSCRIBE_MODEL`).
3. Message sends with `liveDictation: true` over the WebSocket protocol.
4. Harness `speak()` events play through `just_audio` when `AGENT_TTS_ENABLED=1`.

Desktop uses **server-side transcription only** (no Web Speech). Timing knobs
(`AGENT_DICTATION_*_MS`) are exposed on `WireAppConfig` / Settings like web.

**Permissions:** grant microphone access when prompted (Windows Privacy → Microphone;
macOS `NSMicrophoneUsageDescription`; Linux PulseAudio/PipeWire).

## API reference

Endpoints are documented in [Web API → Audio](../reference/web-api.md#audio-transcription-tts).
