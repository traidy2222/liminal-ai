/**
 * Per-harness OpenRouter provider route state — dynamic ignore list and session
 * epoch for sticky routing rotation after upstream 429s.
 */

import { MAX_DYNAMIC_PROVIDER_IGNORES } from "./openrouter_errors.js";
import fs from "node:fs";
import path from "node:path";

// Re-evaluate price/performance once the upstream sticky-session window is idle.
// Persisting yesterday's provider for a full day can lock in an expensive fallback.
const PROVIDER_AFFINITY_IDLE_MS = 10 * 60 * 1000;

export interface ProviderRouteSnapshot {
  ignore: string[];
  epoch: number;
}

/** Mutable routing state owned by one AgentHarness (one chat session). */
export class ProviderRouteState {
  private readonly ignores = new Set<string>();
  private sessionEpoch = 0;
  private readonly preferred = new Map<string, { provider: string; at: number }>();
  private affinityFile?: string;

  configurePersistence(file: string): void {
    this.affinityFile = file;
    try {
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const [key, value] of Object.entries(saved)) {
        const entry = value as { provider?: string; at?: number };
        if (typeof entry.provider === "string" && typeof entry.at === "number" && Date.now() - entry.at < PROVIDER_AFFINITY_IDLE_MS) {
          this.preferred.set(key, { provider: entry.provider, at: entry.at });
        }
      }
    } catch { /* no affinity saved yet */ }
  }

  preferredProvider(model: string, policy: string): string | undefined {
    const entry = this.preferred.get(`${model}:${policy}`);
    if (!entry || Date.now() - entry.at >= PROVIDER_AFFINITY_IDLE_MS) return undefined;
    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
    if ([...this.ignores].some(value => normalize(value) === normalize(entry.provider))) return undefined;
    return entry.provider;
  }

  recordProviderSuccess(model: string, policy: string, provider: string): void {
    if (!/^[a-z0-9][a-z0-9 ._:/()\-]{0,100}$/i.test(provider)) return;
    this.preferred.set(`${model}:${policy}`, { provider, at: Date.now() });
    if (this.preferred.size > 20) this.preferred.delete(this.preferred.keys().next().value!);
    if (this.affinityFile) try {
      fs.mkdirSync(path.dirname(this.affinityFile), { recursive: true });
      const temporary = this.affinityFile + ".tmp";
      fs.writeFileSync(temporary, JSON.stringify(Object.fromEntries(this.preferred)));
      fs.renameSync(temporary, this.affinityFile);
    } catch { /* affinity is best-effort; never block a reply on disk failure */ }
  }

  /** Record a provider that returned 429 / upstream throttle. */
  markProviderRateLimited(slug: string, opts?: { bumpEpoch?: boolean }): void {
    const s = slug.trim();
    for (const [key, entry] of this.preferred) {
      if (s && entry.provider.toLowerCase().replace(/[^a-z0-9]/g, "") === s.toLowerCase().replace(/[^a-z0-9]/g, "")) this.preferred.delete(key);
    }
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
    this.preferred.clear();
  }
}
