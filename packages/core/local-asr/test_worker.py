"""CPU-only regression checks; no model downloads or GPU required."""
import io
import unittest
import wave
import pathlib
from unittest.mock import Mock, patch
import numpy as np
from worker import speech_regions, decode_audio, language_code, Recognizer


class SpeechGateTests(unittest.TestCase):
    def test_warmup_exercises_decoder_once_without_creating_user_text(self):
        recognizer = Recognizer(pathlib.Path('.'), 'whisper', cuda=False)
        recognizer.model = Mock()
        recognizer.model.transcribe.return_value = (iter([]), None)
        recognizer.load = Mock()
        with patch('worker.speech_regions', return_value=[]) as gate:
            self.assertEqual(recognizer.handle({'op': 'warmup'}), dict(text='', noSpeech=True, durationSec=0))
            self.assertEqual(recognizer.handle({'op': 'warmup'}), dict(text='', noSpeech=True, durationSec=0))
            recognizer.load.assert_called_once()
            recognizer.model.transcribe.assert_called_once()
            gate.assert_called_once()

    def test_silence_and_stationary_noise_are_rejected(self):
        self.assertEqual(speech_regions(np.zeros(160000, dtype=np.float32)), [])
        self.assertEqual(speech_regions(np.random.default_rng(42).normal(0, .03, 160000).astype(np.float32)), [])

    def test_explicit_language_wins_and_region_tags_normalize(self):
        for raw, expected in [('auto', None), ('hi-IN', 'hi'), ('en_US', 'en'), ('zh-CN', 'zh'), ('ur', 'ur')]:
            self.assertEqual(language_code(raw), expected)
        with self.assertRaises(ValueError): language_code('unsupported')

    def test_decode_mono_wav_preserves_sample_count(self):
        data = io.BytesIO()
        with wave.open(data, 'wb') as output:
            output.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            output.writeframes(bytes(32000))
        self.assertEqual(len(decode_audio(data.getvalue())), 16000)


if __name__ == '__main__': unittest.main()
