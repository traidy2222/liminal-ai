import type { AppCacheEntry, LiminalAppShell, LiminalAppSpec, SpawnAppInput } from "./app_spec.js";
import type { HtmlEditInput } from "./app_html_patch.js";

export interface UpdateAppPatch {
  title?: string;
  props?: Record<string, unknown>;
  /** edit_file-style patch on stored widget HTML (html apps only) */
  html_edit?: HtmlEditInput & { preview?: boolean };
  refresh?: { interval_min: number };
  placement?: { width: number; height: number; x?: number; y?: number };
  shell?: LiminalAppShell;
  auto_open?: boolean;
}

/** Sidecar implements this; harness tools call through the injected port. */
export interface LiminalAppManagerPort {
  isEnabled(): boolean;
  listApps(): Promise<LiminalAppSpec[]>;
  listAppsWithCaches(): Promise<{ apps: LiminalAppSpec[]; caches: Record<string, AppCacheEntry> }>;
  spawnApp(input: SpawnAppInput): Promise<LiminalAppSpec>;
  updateApp(appId: string, patch: UpdateAppPatch): Promise<LiminalAppSpec>;
  closeApp(appId: string): Promise<boolean>;
  refreshApp(appId: string): Promise<AppCacheEntry>;
}
