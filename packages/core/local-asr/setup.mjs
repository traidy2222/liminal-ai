import { existsSync } from 'node:fs';
import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pinnedUv, run } from '../local-voice/setup.mjs';

const assets = path.dirname(fileURLToPath(import.meta.url));
export const asrHome = () => process.env.LIMINAL_LOCAL_ASR_HOME || path.join(os.homedir(), '.liminal', 'transcription');
export const manifest = JSON.parse(await readFile(path.join(assets, 'manifest.json'), 'utf8'));
const pythonAt = home => path.join(home, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

export async function transcriptionStatus(profile = 'whisper') {
  if (!manifest.profiles[profile]) throw new Error('Choose whisper or qwen.');
  const home = path.join(asrHome(), profile);
  let marker;
  try { marker = JSON.parse(await readFile(path.join(home, 'ready.json'), 'utf8')); } catch { /* first install */ }
  const installed = marker?.revision === manifest.profiles[profile].baseRevision && marker?.runtimeVersion === manifest.runtimeVersion &&
    !existsSync(path.join(home, 'install.lock')) && existsSync(pythonAt(home)) && Object.keys(manifest.profiles[profile].models).every(file => existsSync(path.join(home, 'models', file)));
  return { profile, installed, home, cuda: marker?.cuda ?? false,
    downloadBytes: Object.values(manifest.profiles[profile].models).reduce((sum, file) => sum + file.bytes, 0) };
}

export async function installTranscription({ profile = 'whisper', cuda = false, uv: suppliedUv } = {}) {
  const entry = manifest.profiles[profile];
  if (!entry) throw new Error('Choose whisper or qwen.');
  if ((process.platform === 'win32' && process.arch !== 'x64') ||
      (process.platform === 'darwin' && process.arch !== 'arm64')) throw new Error('Use x64 Windows/Linux or Apple Silicon for local transcription.');
  if (cuda && (process.platform === 'darwin' || process.arch !== 'x64')) throw new Error('--cuda requires x64 Windows/Linux with an NVIDIA GPU.');
  const home = path.join(asrHome(), profile);
  await mkdir(home, { recursive: true });
  let lock;
  try { lock = await open(path.join(home, 'install.lock'), 'wx'); }
  catch { throw new Error('Transcription installation already running. If it was interrupted, remove install.lock in ' + home); }
  try {
    console.log(`Installing local ${profile}: ${(Object.values(entry.models).reduce((n, f) => n + f.bytes, 0) / 1e9).toFixed(1)} GB of models plus runtime. No API key required.`);
    await unlink(path.join(home, 'ready.json')).catch(error => { if (error.code !== 'ENOENT') throw error; });
    const uv = suppliedUv || await pinnedUv(asrHome());
    await run(uv, ['venv', '--python', '3.12', '--managed-python', '--allow-existing', path.join(home, '.venv')]);
    const python = pythonAt(home);
    const deps = ['faster-whisper==1.2.1', 'ctranslate2==4.8.5', 'numpy==1.26.4', 'requests==2.32.5'];
    // Separate environments let optional Qwen dependencies coexist with the installed voice.
    if (profile === 'qwen' || cuda) {
      const torchVersion = profile === 'qwen' ? '2.9.1' : '2.6.0';
      await run(uv, ['pip', 'install', '--python', python, `torch==${torchVersion}`, `torchaudio==${torchVersion}`,
        '--index-url', cuda ? `https://download.pytorch.org/whl/${profile === 'qwen' ? 'cu128' : 'cu124'}` : 'https://download.pytorch.org/whl/cpu',
        '--reinstall-package', 'torch', '--reinstall-package', 'torchaudio']);
    }
    if (profile === 'qwen') deps.push('qwen-asr==0.0.6', 'transformers==4.57.6', 'accelerate==1.12.0');
    await run(uv, ['pip', 'install', '--python', python, ...deps]);
    await run(python, ['-X', 'utf8', '-B', '-u', path.join(assets, 'download_models.py'), '--home', home, '--profile', profile]);
    const marker = { runtimeVersion: manifest.runtimeVersion, revision: entry.baseRevision, cuda };
    // The check needs device settings but failure must never leave a ready installation.
    await writeFile(path.join(home, 'ready.json'), JSON.stringify(marker));
    try { await run(python, ['-X', 'utf8', '-B', '-u', path.join(assets, 'worker.py'), '--home', home, '--profile', profile, '--check']); }
    catch (error) { await unlink(path.join(home, 'ready.json')); throw error; }
    console.log('Ready. Select Whisper fast or Qwen accuracy in Settings → Preferences → Voice. Inference now runs offline.');
  } finally { await lock.close(); await unlink(path.join(home, 'install.lock')); }
}

export async function runTranscriptionCli(args) {
  const [command, ...flags] = args;
  if (flags.some(flag => !['whisper', 'qwen', '--cuda'].includes(flag)) || flags.filter(f => f === 'whisper' || f === 'qwen').length > 1) throw new Error('Choose one profile: whisper or qwen, with optional --cuda.');
  const profile = flags.includes('qwen') ? 'qwen' : 'whisper';
  if (command === 'status') { console.log(JSON.stringify(await transcriptionStatus(profile), null, 2)); return 0; }
  if (command === 'install') { await installTranscription({ profile, cuda: flags.includes('--cuda') }); return 0; }
  console.log('Usage: liminal transcription install [whisper|qwen] [--cuda]\n       liminal transcription status [whisper|qwen]\nDefault: Whisper on CPU. --cuda enables NVIDIA acceleration. Qwen accuracy is optional, supports fewer languages, and needs more memory.');
  return !command || command === '--help' ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runTranscriptionCli(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
