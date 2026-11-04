"""Private offline ASR worker. stdout is JSONL only; model diagnostics go to stderr."""
import argparse
import base64
import io
import json
import os
import pathlib
import sys

os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1")
OUT = sys.stdout
sys.stdout = sys.stderr
DLL_HANDLES = []


def configure_cuda():
    # CTranslate2 needs both the DLL search directory and PATH on Windows.
    if sys.platform == "win32":
        folder = pathlib.Path(sys.prefix) / "Lib/site-packages/torch/lib"
        if folder.exists():
            os.environ["PATH"] = str(folder) + os.pathsep + os.environ.get("PATH", "")
            DLL_HANDLES.append(os.add_dll_directory(str(folder)))
    elif sys.platform == "linux":
        # Linux's dynamic linker reads LD_LIBRARY_PATH when the process starts.
        # Re-exec once so CTranslate2 can find the managed CUDA libraries without
        # requiring users to edit their shell profile or install system CUDA.
        import site
        folders = []
        for packages in site.getsitepackages():
            for relative in ("nvidia/cublas/lib", "nvidia/cudnn/lib", "nvidia/cuda_runtime/lib", "torch/lib"):
                folder = pathlib.Path(packages) / relative
                if folder.is_dir(): folders.append(str(folder))
        existing = os.environ.get("LD_LIBRARY_PATH", "").split(os.pathsep)
        if any(folder not in existing for folder in folders):
            os.environ["LD_LIBRARY_PATH"] = os.pathsep.join(folders + [item for item in existing if item])
            os.execv(sys.executable, [sys.executable, "-X", "utf8", "-B", "-u", __file__, *sys.argv[1:]])


def decode_audio(data):
    import av
    import numpy as np
    chunks = []
    count = 0
    with av.open(io.BytesIO(data)) as container:
        resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
        for frame in container.decode(audio=0):
            for converted in resampler.resample(frame):
                samples = converted.to_ndarray().flatten()
                count += len(samples)
                if count > 16000 * 1800:
                    raise ValueError("Audio exceeds the 30 minute local transcription limit. Split it first.")
                chunks.append(samples)
        for converted in resampler.resample(None):
            chunks.append(converted.to_ndarray().flatten())
    return np.concatenate(chunks).astype(np.float32) / 32768 if chunks else np.zeros(0, dtype=np.float32)


def speech_regions(audio):
    """Use neural speech probability, never loudness or a blacklist of phrases."""
    import numpy as np
    from faster_whisper.vad import get_speech_timestamps, VadOptions
    if len(audio) < 3200 or not np.isfinite(audio).all() or np.max(np.abs(audio)) < 0.0001:
        return []
    return get_speech_timestamps(audio, VadOptions(
        threshold=0.65, min_speech_duration_ms=200, min_silence_duration_ms=400,
        speech_pad_ms=160, max_speech_duration_s=25,
    ))


def language_code(raw):
    from faster_whisper.tokenizer import _LANGUAGE_CODES
    # Whisper's public tokenizer vocabulary supplies the supported ISO codes;
    # names are accepted through the bundled language map, not guessed from locale.
    value = str(raw or "").strip().lower().replace("_", "-")
    if value in ("", "auto"): return None
    value = value.split("-")[0]
    if value == "fil": value = "tl"
    if value not in _LANGUAGE_CODES:
        raise ValueError("Choose an ISO-639 language code (for example en, hi, zh), or auto.")
    return value


QWEN_LANGUAGES = dict(zip(
    "zh en yue ar de fr es pt id it ko ru th vi ja tr hi ms nl sv da fi pl cs tl fa el hu ro mk".split(),
    "Chinese English Cantonese Arabic German French Spanish Portuguese Indonesian Italian Korean Russian Thai Vietnamese Japanese Turkish Hindi Malay Dutch Swedish Danish Finnish Polish Czech Filipino Persian Greek Hungarian Romanian Macedonian".split(),
))


class Recognizer:
    def __init__(self, home, profile, cuda=None):
        self.profile = profile
        self.home = home
        self.model = None  # Load only after the neural gate finds speech.
        self.warmed = False
        if cuda is not None: self.cuda = cuda
        elif (home / "ready.json").exists(): self.cuda = json.loads((home / "ready.json").read_text())["cuda"]
        else: self.cuda = False

    def load(self):
        if self.model is not None: return
        models = str(self.home / "models")
        if self.profile == "whisper":
            from faster_whisper import WhisperModel
            self.model = WhisperModel(models, device="cuda" if self.cuda else "cpu",
                                      compute_type="float16" if self.cuda else "int8", local_files_only=True)
        else:
            import torch
            from qwen_asr import Qwen3ASRModel
            if self.cuda and not torch.cuda.is_available():
                raise RuntimeError("Qwen CUDA runtime cannot see an NVIDIA GPU. Reinstall without --cuda for CPU.")
            self.model = Qwen3ASRModel.from_pretrained(
                models, dtype=torch.bfloat16 if self.cuda else torch.float32,
                device_map="cuda:0" if self.cuda else "cpu", attn_implementation="sdpa",
                max_inference_batch_size=1, max_new_tokens=512,
            )

    def warmup(self):
        if not self.warmed:
            import numpy as np
            self.load()
            # Exercise the decoder and neural gate as well as loading weights.
            # Silence is internal warmup input and is never emitted as a transcript.
            speech_regions(np.zeros(16000, dtype=np.float32) + .001)
            if self.profile == "whisper":
                list(self.model.transcribe(np.zeros(16000, dtype=np.float32), language="en", beam_size=1)[0])
            else:
                self.model.transcribe(audio=(np.zeros(16000, dtype=np.float32), 16000), language="English")
            self.warmed = True
        return dict(text="", noSpeech=True, durationSec=0)

    def handle(self, request):
        return self.warmup() if request.get("op") == "warmup" else self.transcribe(request)

    def transcribe(self, request):
        audio = decode_audio(base64.b64decode(request["audio"], validate=True))
        duration = len(audio) / 16000
        language = language_code(request.get("language"))
        if self.profile == "qwen" and language and language not in QWEN_LANGUAGES:
            raise ValueError(f"Qwen accuracy mode does not support '{language}'. Use Whisper fast mode for this language.")
        regions = speech_regions(audio)
        if not regions:
            return dict(text="", noSpeech=True, durationSec=duration, language=language)
        self.load()
        if self.profile == "whisper":
            # VAD removes noise/silence before language detection. Explicit language
            # always wins; no browser locale and no Urdu -> Hindi heuristics.
            segments, info = self.model.transcribe(
                audio, language=language, task="transcribe", beam_size=1,
                condition_on_previous_text=False, temperature=0,
                vad_filter=True, vad_parameters=dict(threshold=0.65, min_speech_duration_ms=200,
                    min_silence_duration_ms=400, speech_pad_ms=160, max_speech_duration_s=25),
                word_timestamps=request.get("timestamps") == "word",
                no_speech_threshold=0.6, log_prob_threshold=-1.0,
                initial_prompt=str(request.get("prompt") or "")[:1500] or None,
                language_detection_segments=3,
            )
            accepted = [s for s in segments if not (s.no_speech_prob > 0.6 and s.avg_logprob < -1.0)]
            text = "".join(s.text for s in accepted).strip()
            result = dict(text=text, language=info.language, languageConfidence=info.language_probability,
                          durationSec=duration, noSpeech=not bool(text))
            if request.get("timestamps") != "none":
                result["segments"] = [dict(start=s.start, end=s.end, text=s.text.strip()) for s in accepted]
            if request.get("timestamps") == "word":
                result["words"] = [dict(start=w.start, end=w.end, word=w.word, probability=w.probability)
                                   for s in accepted for w in (s.words or [])]
            return result
        texts, languages = [], []
        # Bound decoding and output tokens by VAD speech spans; do not silently
        # truncate a long recording at the model's generation cap.
        for region in regions:
            clip = audio[region["start"]:region["end"]]
            result = self.model.transcribe(audio=(clip, 16000), language=QWEN_LANGUAGES.get(language))[0]
            if result.text.strip(): texts.append(result.text.strip())
            if result.language: languages.append(result.language)
        reverse = {name.lower(): code for code, name in QWEN_LANGUAGES.items()}
        detected = reverse.get(languages[0].lower(), languages[0]) if languages else language
        text = " ".join(texts)
        return dict(text=text, language=language or detected, durationSec=duration, noSpeech=not bool(text))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", type=pathlib.Path, required=True)
    parser.add_argument("--profile", choices=["whisper", "qwen"], required=True)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--cuda", action="store_true", default=None)
    args = parser.parse_args()
    configure_cuda()
    recognizer = Recognizer(args.home, args.profile, args.cuda)
    if args.check:
        recognizer.load()
        import numpy as np
        speech_regions(np.random.default_rng(42).normal(0, .03, 16000).astype(np.float32))
        # Exercise inference, not only loading: DLL/ABI failures can appear on the
        # first convolution or decode even when loading the model succeeded.
        if args.profile == "qwen":
            recognizer.model.transcribe(audio=(np.zeros(16000, dtype=np.float32), 16000), language="English")
        else:
            list(recognizer.model.transcribe(np.zeros(16000, dtype=np.float32), language="en", beam_size=1)[0])
        print("Local transcription runtime checked.")
        return
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            result = recognizer.handle(request)
            OUT.write(json.dumps(dict(id=request["id"], result=result), ensure_ascii=False) + "\n")
        except Exception as error:
            OUT.write(json.dumps(dict(id=request.get("id"), error=str(error))) + "\n")
        OUT.flush()


if __name__ == "__main__": main()
