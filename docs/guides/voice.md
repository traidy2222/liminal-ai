# Voice (TTS &amp; dictation)

The web UI can **speak its replies** (text-to-speech) and **listen** (dictation/transcription),
so you can drive the agent hands-free. Local transcription and speech settings are shared by desktop and web.

## Dictation (speech → text)

Record in the browser and send the clip for transcription:

- `POST /api/audio/upload` persists the clip under the active chat and returns an
  `attachmentId` (audio is sent as a base64 data URL — `audio/webm`, etc.).
- `POST /api/transcribe` runs ASR on that id and returns the text, duration, language, and
  cost.

In the agent loop, `transcribe_audio` (the `audio` family) does the same server-side.

### Local transcription: fast or accuracy

Both desktop and web now default to **Whisper Large V3 Turbo on this computer**.
Qwen3-ASR 1.7B is an optional accuracy mode. Neither needs an API key, and neither
silently falls back to a cloud provider. Existing Parakeet default selections migrate to Whisper.
Explicit alternative cloud models remain available for compatibility.

Install once, then choose **Settings → Preferences → Transcription mode**:

```bash
liminal transcription install whisper --cuda   # NVIDIA, about 1.6 GB of models
liminal transcription install qwen --cuda      # Optional accuracy, about 4.7 GB
liminal transcription status whisper
liminal transcription status qwen
```

Omit `--cuda` for CPU inference. Python and dependencies need additional disk space.
CPU mode is supported but may be too slow for live dictation, particularly Qwen.
Installers use separate managed Python environments; they do not modify system Python
or the local voice environment. NVIDIA mode uses CUDA 12.4 for Whisper and CUDA 12.8
for Qwen; install a compatible NVIDIA driver first. Windows uses the native Transformers
backend for Qwen, so its latency differs from the vLLM benchmark run under WSL.

For portable desktop bundles, run from `liminald/repo`:

```bash
node packages/core/local-asr/setup.mjs install whisper --cuda
node packages/core/local-asr/setup.mjs install qwen --cuda
```

Models live in `~/.liminal/transcription` and survive app updates. Files are pinned to
model revisions and verified with SHA-256 during installation. Inference runs offline.
Switching transcription modes unloads the old worker; idle workers exit after two minutes.

The microphone shows **provisional local previews** while recording. Previews use a rolling
12-second window with one request in flight to bound memory and decoding time; long takes
show the most recent window. The final transcript always uses the complete recording and
is sent once, after a pause or manual send. Previews are not persisted as chat attachments.
Browser-vendor Web Speech has been removed from this path; `AGENT_DICTATION_WEB_SPEECH`
is retained only as a deprecated compatibility setting.

A neural Silero speech gate rejects silence and stationary noise before decoding. Empty
results are marked `noSpeech` and are never auto-sent. This reduces hallucinations; it cannot
guarantee rejection of every kind of music, background speech, or unfamiliar noise.

**Language:** `auto` detects from actual speech, not browser locale. Set an ISO code such
as `hi` when you want Hindi, or `ur` for Urdu. Explicit language always wins. Whisper can
still confuse closely related languages even with high detection confidence; use an explicit
language or Qwen accuracy mode in that case. Whisper has broader language coverage; Qwen
supports 30 languages and returns a clear error for unsupported selections. Qwen does not
return word timestamps without a separately installed forced aligner; Liminal does not invent them.

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `AGENT_TRANSCRIBE_ENABLED` | `1` | Master switch; local ASR works in single-model chat mode |
| `AGENT_TRANSCRIBE_MODEL` | `local/whisper-large-v3-turbo` | Fast default; optional `local/qwen3-asr-1.7b` |
| `AGENT_TRANSCRIBE_LANGUAGE` | `auto` | Explicit ISO language code or speech-based detection |
| `AGENT_TRANSCRIBE_MAX_BYTES` | `26214400` | Compressed file limit; decoded recordings are capped at 30 minutes |
| `AGENT_TRANSCRIBE_API_KEY` | — | Only used by explicitly selected legacy cloud providers |
| `AGENT_DICTATION_AUDIO_CUE` | `0` | Optional send cue |

## Text-to-speech (text → speech)

- `POST /api/tts` synthesizes speech (segmented for long text) and returns clip ids + cost.
- `GET /api/tts/clip/:clipId` streams a clip's audio bytes.

Text is sanitized and capped per call, with duplicate-clip suppression and a per-turn speech
budget so the agent doesn't read back everything. The `speak` tool exposes TTS in the loop.

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `AGENT_TTS_ENABLED` | off | Master switch for TTS |
| `AGENT_TTS_VOICE` | `af_sky` | Default voice |

## Local JARVIS Warm voice

**JARVIS Warm — local** uses the bundled experimental Chatterbox Turbo voice adapter and
the warmer, original-pitch profile. It softens the upper frequencies without pitch shifting,
and targets a comfortable −23 LUFS output. Both desktop and web use the same on-device backend.

Install once from a Liminal checkout:

```bash
liminal voice install             # Managed Python + CPU runtime + about 3 GB of model weights
liminal voice install --cuda      # NVIDIA CUDA 12.4 runtime instead
liminal voice status
```

`npm run voice:install` is equivalent. In a portable desktop installation, open its
`liminald/repo` folder and run `node packages/core/local-voice/setup.mjs install`.
No system Python, Git or FFmpeg is needed; setup downloads a checksum-verified Python installer,
creates a dedicated Python 3.11 environment, and verifies pinned model files.
Allow extra disk space for Python and PyTorch in addition to the 3 GB of weights.
The pinned runtime supports Windows x64, Linux x64/arm64 and Apple Silicon macOS.
Intel Macs and native Windows ARM64 are not supported by these PyTorch wheels.

Then open **Settings → Preferences → Speech model**, choose **Use JARVIS Warm — local**,
and enable **Spoken responses**. Alternatively configure:

```bash
AGENT_TTS_ENABLED=1
AGENT_TTS_MODEL=local/jarvis-warm
```

The voice runs offline after installation, requires no speech API key, and never falls back to
a cloud speech provider. It can be explicitly enabled alongside single-model chat mode;
cloud speech and other specialist-model restrictions remain in force.
Arm the mic session for the existing spoken-response flow, or use `POST /api/tts` for playback.

Models live in `~/.liminal/voices/jarvis-warm-v1`, separate from application updates.
The worker remains warm between requests, releases its resources after two minutes idle,
and is stopped on cancellation. First playback includes model loading; CPU inference can be slow.
CUDA is used when installed and sufficient GPU memory is available; otherwise synthesis uses CPU.
The response is a normal WAV clip playable by both clients. Speech clips are cached per voice/model,
so switching from a cloud voice cannot replay stale audio in the previous voice.

This is a small-data experimental voice, not a guarantee of exact JARVIS likeness. Source provenance,
training details and model checksums ship under `packages/core/local-voice/`. The standard
Chatterbox watermark is retained. No training corpus is included in the app.

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
