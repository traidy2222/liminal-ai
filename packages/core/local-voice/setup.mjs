import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, writeFile, chmod, open, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const voiceAssetsDir = path.dirname(fileURLToPath(import.meta.url));
export const voiceHome = () => process.env.LIMINAL_LOCAL_VOICE_HOME || path.join(os.homedir(), '.liminal', 'voices', manifest.id);
export const voicePython = (home = voiceHome()) => path.join(home, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
export const manifest = JSON.parse(await readFile(path.join(voiceAssetsDir, 'manifest.json'), 'utf8'));

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', windowsHide: true, ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} failed (${signal || code}).`)));
  });
}

export async function pinnedUv(home, runCommand = run) {
  const platform = { win32: 'pc-windows-msvc.zip', darwin: 'apple-darwin.tar.gz', linux: 'unknown-linux-gnu.tar.gz' }[process.platform];
  const arch = { x64: 'x86_64', arm64: 'aarch64' }[process.arch];
  if (!platform || !arch) throw new Error('Local voice supports Windows, macOS and Linux on x64/arm64.');
  const asset = manifest.uvAssets.find(a => a.name === `uv-${arch}-${platform}`);
  if (!asset?.digest?.startsWith('sha256:')) throw new Error('Missing pinned Python installer checksum.');
  const binDir = path.join(home, 'uv', manifest.uvVersion);
  const binary = path.join(binDir, process.platform === 'win32' ? 'uv.exe' : 'uv');
  if (existsSync(binary)) return binary;
  await mkdir(binDir, { recursive: true });
  console.log('Downloading the local Python installer…');
  const response = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Python installer download failed: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length !== asset.size || createHash('sha256').update(data).digest('hex') !== asset.digest.slice(7)) {
    throw new Error('Python installer checksum mismatch. Nothing was executed.');
  }
  const archive = path.join(binDir, asset.name);
  await writeFile(archive, data);
  await runCommand(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-xf', archive, '-C', binDir]);
  // Unix archives contain a single platform directory; Windows places uv.exe at the root.
  if (!existsSync(binary)) {
    const entries = await readdir(binDir, { withFileTypes: true });
    const directory = entries.find(e => e.isDirectory() && e.name === asset.name.replace(/\.(tar\.gz|zip)$/, ''));
    if (!directory) throw new Error('Python installer archive has an unexpected layout.');
    await rename(path.join(binDir, directory.name, path.basename(binary)), binary);
  }
  if (process.platform !== 'win32') await chmod(binary, 0o755);
  return binary;
}

export async function localVoiceStatus() {
  const home = voiceHome();
  let marker;
  try { marker = JSON.parse(await readFile(path.join(home, 'ready.json'), 'utf8')); } catch { /* not installed */ }
  const installed = marker?.id === manifest.id && marker?.baseRevision === manifest.baseRevision &&
    existsSync(voicePython(home)) && Object.keys(manifest.models).every(name => existsSync(path.join(home, 'models', name)));
  return { installed, home, model: manifest.model, label: manifest.label, downloadBytes: Object.values(manifest.models).reduce((sum, f) => sum + f.bytes, 0) };
}

export function torchInstallArgs(python, cuda, previousVariant, wasReady) {
  const variant = cuda ? 'cuda124' : 'cpu';
  const args = ['pip', 'install', '--python', python, 'torch==2.6.0', 'torchaudio==2.6.0', '--index-url',
    cuda ? 'https://download.pytorch.org/whl/cu124' : 'https://download.pytorch.org/whl/cpu'];
  // +cpu and +cu124 both satisfy torch==2.6.0; an index change alone will not switch them.
  if (previousVariant !== variant || !wasReady) args.push('--reinstall-package', 'torch', '--reinstall-package', 'torchaudio');
  return args;
}

export async function installLocalVoice({ cuda = false, uv: suppliedUv } = {}) {
  if ((process.platform === 'win32' && process.arch !== 'x64') || (process.platform === 'darwin' && process.arch !== 'arm64')) {
    throw new Error('This voice runtime requires x64 Node on Windows or Apple Silicon on macOS. PyTorch 2.6 has no native Windows ARM64 or Intel Mac wheels.');
  }
  if (cuda && (process.platform === 'darwin' || process.arch !== 'x64')) throw new Error('--cuda requires an x64 Windows or Linux system with an NVIDIA GPU.');
  const home = voiceHome();
  await mkdir(home, { recursive: true });
  let lock;
  try { lock = await open(path.join(home, 'install.lock'), 'wx'); }
  catch { throw new Error('Another local voice installation is running. If it was interrupted, remove install.lock from the voice folder and retry.'); }
  try {
    console.log('Installing JARVIS Warm locally. Models require about 3 GB; Python and dependencies need additional space.');
    let previousVariant, ready;
    try { ready = JSON.parse(await readFile(path.join(home, 'ready.json'), 'utf8')); } catch { /* first install */ }
    try { previousVariant = JSON.parse(await readFile(path.join(home, 'torch-variant.json'), 'utf8')).variant; } catch {
      if (typeof ready?.cuda === 'boolean') previousVariant = ready.cuda ? 'cuda124' : 'cpu';
    }
    await unlink(path.join(home, 'ready.json')).catch(error => { if (error.code !== 'ENOENT') throw error; });
    const uv = suppliedUv || await pinnedUv(home);
    // Managed Python avoids requiring a system Python, pip, Git, FFmpeg or a user-specific environment.
    await run(uv, ['venv', '--python', '3.11', '--managed-python', '--allow-existing', path.join(home, '.venv')]);
    const python = voicePython(home);
    await run(uv, torchInstallArgs(python, cuda, previousVariant, Boolean(ready)));
    // Keep actual installed variant even if a later dependency/model step fails.
    await writeFile(path.join(home, 'torch-variant.json'), JSON.stringify({ variant: cuda ? 'cuda124' : 'cpu' }));
    await run(uv, ['pip', 'install', '--python', python, '-r', path.join(voiceAssetsDir, 'requirements.txt')]);
    // Install only the pinned inference source. Its optional Gradio and multilingual extras are unused.
    await run(uv, ['pip', 'install', '--python', python, '--no-deps', 'https://github.com/resemble-ai/chatterbox/archive/5de7a54aa4e5e2baadb0182dde554908b48b85c2.zip']);
    await run(python, ['-X', 'utf8', '-B', '-u', path.join(voiceAssetsDir, 'download_models.py'), '--home', home]);
    await run(python, ['-X', 'utf8', '-B', '-u', path.join(voiceAssetsDir, 'worker.py'), '--home', home, '--check']);
    await writeFile(path.join(home, 'ready.json'), JSON.stringify({ id: manifest.id, baseRevision: manifest.baseRevision, cuda, installedAt: new Date().toISOString() }, null, 2));
    console.log('JARVIS Warm is ready. In Settings → Preferences choose the local speech model and enable Spoken responses.');
  } finally {
    await lock.close();
    // Only our exact lock file is removed; downloaded models and existing settings are retained.
    await unlink(path.join(home, 'install.lock'));
  }
}

export async function runVoiceCli(args) {
  const [command, ...flags] = args;
  if (command === 'status') { console.log(JSON.stringify(await localVoiceStatus(), null, 2)); return 0; }
  if (command !== 'install' || flags.some(f => f !== '--cuda')) {
    console.log('Usage: liminal voice install [--cuda]\n       liminal voice status\n\nDefault: CPU. --cuda installs NVIDIA CUDA 12.4 wheels. Models are downloaded once; speech then runs offline.');
    return !command || command === '--help' ? 0 : 1;
  }
  await installLocalVoice({ cuda: flags.includes('--cuda') });
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runVoiceCli(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
