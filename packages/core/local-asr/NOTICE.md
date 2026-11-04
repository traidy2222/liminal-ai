# Local transcription runtime

Inference uses unmodified, revision-pinned model weights downloaded during installation:

- [Whisper Large V3 Turbo converted for CTranslate2](https://huggingface.co/mobiuslabsgmbh/faster-whisper-large-v3-turbo), based on [OpenAI Whisper](https://github.com/openai/whisper) (MIT).
- [Qwen3-ASR 1.7B](https://huggingface.co/Qwen/Qwen3-ASR-1.7B) (Apache-2.0).
- Neural speech gating uses the Silero VAD model distributed with [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (MIT); [Silero VAD](https://github.com/snakers4/silero-vad) is MIT licensed.

The manifest records model revisions and SHA-256 hashes. Python package distributions retain
their upstream licence files in each managed environment. Model weights and Python environments
are not embedded in the desktop installer. No provider credentials are needed for local inference.
