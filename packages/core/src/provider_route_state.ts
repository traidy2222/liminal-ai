/**
 * Per-harness OpenRouter provider route state — dynamic ignore list and session
 * epoch for sticky routing rotation after upstream 429s.
 */

import { MAX_DYNAMIC_PROVIDER_IGNORES } from "./openrouter_errors.js";

export interface ProviderRouteSnapshot {
  ignore: string[];
  epoch: number;
}

/** Mutable routing state owned by one AgentHarness (one chat session). */
export class ProviderRouteState {
  private readonly ignores = new Set<string>();
  private sessionEpoch = 0;

  /** Record a provider that returned 429 / upstream throttle. */
  markProviderRateLimited(slug: string, opts?: { bumpEpoch?: boolean }): void {
    const s = slug.trim();
    if (s) {
      if (this.ignores.has(s)) this.ignores.delete(s);
      this.ignores.add(s);
      while (this.ignores.size > MAX_DYNAMIC_PROVIDER_IGNORES) {
        const oldest = this.ignores.values().next().value;
        if (oldest) this.ignores.delete(oldest);
      }
    }
    if (opts?.bumpEpoch) this.sessionEpoch += 1;
  }

  /** Clear dynamic ignores after OpenRouter reports no providers left (404). */
  clearProviderIgnores(): void {
    this.ignores.clear();
  }

  /** Session id suffix when epoch > 0 breaks sticky binding after rotation. */
  resolveSessionId(baseId: string): string {
    const base = baseId.trim();
    if (!base) return base;
    return this.sessionEpoch > 0 ? `${base}#${this.sessionEpoch}` : base;
  }

  snapshot(): ProviderRouteSnapshot {
    return { ignore: [...this.ignores], epoch: this.sessionEpoch };
  }

  /** Test / reset hook. */
  reset(): void {
    this.ignores.clear();
    this.sessionEpoch = 0;
  }
}
