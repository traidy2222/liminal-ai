/** Bounded, provisional previews. Final text always comes from the complete recorded take. */
export class LocalPreview {
  private pcm: Int16Array[] = [];
  private samples = 0;
  private busy = false;
  private generation = 0;
  private lastRequest = 0;
  private abort?: AbortController;
  constructor(private readonly request: (wav: string, signal: AbortSignal) => Promise<string>,
    private readonly onText: (text: string) => void) {}

  reset(cancel = false): void {
    this.generation++; this.pcm = []; this.samples = 0; this.lastRequest = 0;
    if (cancel) this.abort?.abort();
  }

  push(samples: Float32Array, sampleRate: number): void {
    const pcm = new Int16Array(Math.floor(samples.length * 16000 / sampleRate));
    for (let i = 0; i < pcm.length; i++) {
      const at = i * sampleRate / 16000;
      const left = Math.floor(at), fraction = at - left;
      const value = (samples[left] ?? 0) * (1 - fraction) + (samples[left + 1] ?? samples[left] ?? 0) * fraction;
      pcm[i] = Math.round(Math.max(-1, Math.min(1, value)) * 32767);
    }
    this.pcm.push(pcm); this.samples += pcm.length;
    // A rolling 12 s window avoids ever-growing decode time on long utterances.
    const maximum = 12 * 16000;
    while (this.samples > maximum) {
      const first = this.pcm[0]!;
      const drop = Math.min(first.length, this.samples - maximum);
      if (drop === first.length) this.pcm.shift(); else this.pcm[0] = first.slice(drop);
      this.samples -= drop;
    }
    const now = Date.now();
    if (this.busy || this.samples < 12800 || now - this.lastRequest < 800) return;
    this.busy = true; this.lastRequest = now;
    const generation = this.generation;
    const abort = new AbortController(); this.abort = abort;
    void this.request(pcmWavBase64(this.pcm, this.samples), abort.signal).then(text => {
      if (generation === this.generation && !abort.signal.aborted) this.onText(text);
    }).catch(() => { /* Final transcription surfaces setup/inference errors once. */ }).finally(() => {
      this.busy = false;
      if (this.abort === abort) this.abort = undefined;
    });
  }
}

export function pcmWavBase64(chunks: Int16Array[], samples: number): string {
  const bytes = new Uint8Array(44 + samples * 2), view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i); };
  text(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); text(8, "WAVEfmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, samples * 2, true);
  let at = 44;
  for (const chunk of chunks) for (const sample of chunk) { view.setInt16(at, sample, true); at += 2; }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
