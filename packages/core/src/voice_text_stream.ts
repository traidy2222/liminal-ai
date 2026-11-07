/** Sentence-sized synthesis runs alongside the LLM, with a bounded per-turn queue. */
export class VoiceTextStream {
  private buffer = "";
  private queue: Promise<void> = Promise.resolve();
  private controller = new AbortController();
  private received = 0;
  private first = true;
  private inCode = false;
  private timer?: ReturnType<typeof setTimeout>;
  private failed = false;

  constructor(private readonly speak: (text: string, signal: AbortSignal) => Promise<void>,
    private readonly onError: (error: unknown) => void,
    private readonly maxChars = 4096) {}

  push(delta: string): void {
    if (this.controller.signal.aborted || this.failed || this.received >= this.maxChars) return;
    const text = delta.slice(0, this.maxChars - this.received);
    this.received += text.length;
    this.buffer += text;
    this.drain(false);
    if (this.timer) clearTimeout(this.timer);
    // A sentence at the end of a delta need not wait for another token to arrive.
    this.timer = setTimeout(() => {
      if (this.buffer.trim().length >= 24 && /[.!?]["”’')\]]*\s*$/.test(this.buffer) &&
          !/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e)\.$/i.test(this.buffer.trim())) this.drain(true);
    }, 60);
    this.timer.unref?.();
  }

  private drain(final: boolean): void {
    while (this.buffer) {
      const fence = this.buffer.indexOf('```');
      if (this.inCode) {
        if (fence < 0) {
          // Keep partial fence delimiters split across provider deltas.
          this.buffer = this.buffer.endsWith('``') ? '``' : this.buffer.endsWith('`') ? '`' : '';
          return;
        }
        this.buffer = this.buffer.slice(fence + 3); this.inCode = false; continue;
      }
      if (fence === 0) { this.buffer = this.buffer.slice(3); this.inCode = true; continue; }
      // Start promptly, then let later sentences share context and prosody.
      // A short acknowledgement should not become a detached one-word clip.
      if (!this.first && !final && this.buffer.length < 180 && fence < 0) return;
      const limit = this.first ? 100 : 240;
      let end = 0;
      const sentence = /[.!?]["”’')\]]*(?:\s+|$)/g;
      for (const match of this.buffer.matchAll(sentence)) {
        const boundary = match.index! + match[0].length;
        // Keep abbreviations and decimal numbers attached to their sentence.
        if (/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc)\.$/i.test(this.buffer.slice(0, boundary).trim())) continue;
        if (!final && boundary === this.buffer.length && !/\s$/.test(match[0])) break;
        if (boundary >= 24 || final) {
          if (!this.first && boundary > limit && end) break;
          end = boundary;
          if (this.first || boundary >= limit) break;
        }
      }
      // A long first sentence or final flush must obey the same clip bound.
      // Otherwise one unbroken narration paragraph becomes a slow synthesis job.
      if ((!end || end > limit) && this.buffer.length > limit) {
        const prefix = this.buffer.slice(0, limit);
        const clause = Math.max(prefix.lastIndexOf(', '), prefix.lastIndexOf('; '), prefix.lastIndexOf(': '));
        end = clause >= 60 ? clause + 1 : Math.max(prefix.lastIndexOf(' '), 0) || limit;
      }
      if (fence > 0 && (!end || fence < end)) end = fence;
      if (!end && final) end = this.buffer.length;
      if (!end) return;
      const chunk = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end);
      if (!chunk) continue;
      this.first = false;
      const signal = this.controller.signal;
      this.queue = this.queue.then(async () => {
        if (!signal.aborted && !this.failed) await this.speak(chunk, signal);
      }).catch(error => {
        if (!signal.aborted && !this.failed) { this.failed = true; this.onError(error); }
      });
    }
  }

  finish(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.drain(true);
    return this.queue;
  }

  cancel(): void {
    this.controller.abort();
    if (this.timer) clearTimeout(this.timer);
    this.buffer = "";
  }

  get hasText(): boolean { return this.received > 0; }
}
