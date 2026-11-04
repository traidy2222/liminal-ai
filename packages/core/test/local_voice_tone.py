import importlib.util,json,pathlib,unittest
import numpy as np
from scipy.signal import welch

assets=pathlib.Path(__file__).resolve().parents[1]/'local-voice'
spec=importlib.util.spec_from_file_location('tone',assets/'tone.py')
tone=importlib.util.module_from_spec(spec);spec.loader.exec_module(tone)
config=json.loads((assets/'manifest.json').read_text(encoding='utf8'))['tone']

class WarmVoiceTests(unittest.TestCase):
    def test_softens_high_frequencies_without_pitch_or_duration_change(self):
        sr=24000;t=np.arange(sr*2)/sr
        original=(.18*np.sin(2*np.pi*160*t)+.06*np.sin(2*np.pi*3200*t)+.04*np.sin(2*np.pi*6000*t)).astype(np.float32)
        result=tone.warm_original_pitch(original,sr,config)
        self.assertEqual(len(original),len(result));self.assertTrue(np.all(np.isfinite(result)))
        self.assertLessEqual(np.max(np.abs(result)),.708)
        f,before=welch(original,sr,nperseg=24000)
        _,after=welch(result,sr,nperseg=24000)
        self.assertEqual(f[np.argmax(before)],f[np.argmax(after)])
        band=(f>2500)&(f<8000);body=(f>100)&(f<1000)
        ratio_before=before[band].sum()/before[body].sum()
        ratio_after=after[band].sum()/after[body].sum()
        self.assertLess(10*np.log10(ratio_after/ratio_before),-3)
    def test_silence_remains_silent(self):
        audio=np.zeros(24000,dtype=np.float32)
        self.assertTrue(np.array_equal(tone.warm_original_pitch(audio,24000,config),audio))

if __name__=='__main__':unittest.main()
