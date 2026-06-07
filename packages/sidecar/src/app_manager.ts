import {
  effectiveHarnessEnvRaw,
  isHtmlCapableType,
  normalizeAppShell,
  type AppCacheEntry,
  type LiminalAppManagerPort,
  type LiminalAppSpec,
  type SpawnAppInput,
  type UpdateAppPatch,
  applyHtmlEdit,
  buildAppSpecFromSpawn,
  getApp,
  getAppTypeMeta,
  listApps,
  resolveStoredAppHtml,
  readAllAppCaches,
  readAppCache,
  removeApp,
  upsertApp,
  validateAppProps,
  writeAppCache,
} from "@liminal/core";
import { fetchWeather } from "@liminal/tools";
import { serverFrame, type ServerFrame } from "@liminal/protocol";
import {
  buildHtmlDocumentForSpec,
  persistRenderedDocument,
  prepareSpecPropsForStorage,
} from "./liminal_app_runtime.js";

export type AppFrameSink = (frame: ServerFrame) => void;

async function fetchJsonUrl(url: string, method: string): Promise<unknown> {
  const res = await fetch(url, {
    method: method === "POST" ? "POST" : "GET",
    headers: { Accept: "application/json, text/plain, */*" },
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text, status: res.status };
  }
}

export class LiminalAppManager implements LiminalAppManagerPort {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private readonly lastRefreshAt = new Map<string, number>();

  constructor(private readonly sink: AppFrameSink) {}

  isEnabled(): boolean {
    return effectiveHarnessEnvRaw("AGENT_LIMINAL_APPS") !== "0";
  }

  startRefreshLoop(): void {
    if (this.refreshTimer) return;
    if (effectiveHarnessEnvRaw("AGENT_APP_REFRESH_ENABLED") === "0") return;
    this.refreshTimer = setInterval(() => {
      void this.refreshAllDue().catch(() => undefined);
    }, 60_000);
    if (typeof this.refreshTimer === "object" && "unref" in this.refreshTimer) {
      this.refreshTimer.unref();
    }
  }

  stopRefreshLoop(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  async listApps(): Promise<LiminalAppSpec[]> {
    return listApps();
  }

  async listAppsWithCaches(): Promise<{ apps: LiminalAppSpec[]; caches: Record<string, AppCacheEntry> }> {
    const apps = await this.listApps();
    const caches = await readAllAppCaches();
    return { apps, caches };
  }

  async spawnApp(input: SpawnAppInput): Promise<LiminalAppSpec> {
    if (!this.isEnabled()) throw new Error("Liminal apps are disabled (AGENT_LIMINAL_APPS=0).");

    const maxRaw = Number(effectiveHarnessEnvRaw("AGENT_APP_MAX_COUNT") ?? "8");
    const maxCount = Number.isFinite(maxRaw) ? Math.max(1, Math.min(32, maxRaw)) : 8;
    const existing = await listApps();
    const built = buildAppSpecFromSpawn(input);
    if (!built.ok) throw new Error(built.error);

    const duplicate = existing.find((a) => a.id === built.spec.id);
    if (duplicate) {
      throw new Error(
        `Desktop app "${built.spec.id}" already exists (type=${duplicate.type}, title="${duplicate.title}"). ` +
          `Use update_app({ id: "${built.spec.id}", ... }) to change it — do not call spawn_app again.`
      );
    }
    if (existing.length >= maxCount) {
      throw new Error(`App limit reached (${maxCount}). Close an app before spawning another.`);
    }

    let spec = await prepareSpecPropsForStorage(built.spec.id, built.spec);
    spec = await upsertApp(spec);
    await this.refreshApp(spec.id);
    const refreshed = await getApp(spec.id);
    if (refreshed) spec = refreshed;
    this.sink(serverFrame("app_spawned", { app: spec }));
    await this.broadcastAppList();
    return spec;
  }

  async updateApp(appId: string, patch: UpdateAppPatch): Promise<LiminalAppSpec> {
    const current = await getApp(appId);
    if (!current) throw new Error(`Unknown app id: ${appId}`);

    let propsFromPatch = patch.props;

    if (patch.html_edit) {
      if (current.type !== "html") {
        throw new Error("html_edit is only valid for type=html apps.");
      }
      if (patch.html_edit.preview) {
        throw new Error("html_edit preview is handled by the tool layer.");
      }
      const stored = await resolveStoredAppHtml(current);
      const edited = applyHtmlEdit(stored, patch.html_edit);
      if (edited.report.some((r) => r.startsWith("ERROR"))) {
        throw new Error(edited.report.filter((r) => r.startsWith("ERROR")).join(" "));
      }
      if (!edited.changed) {
        throw new Error(edited.report.join(" ") || "html_edit made no changes.");
      }
      propsFromPatch = {
        ...(propsFromPatch ?? {}),
        html: edited.content,
        interactivity: "sandbox",
      };
    }

    const nextProps = propsFromPatch
      ? (() => {
          const merged = { ...current.props, ...propsFromPatch };
          const v = validateAppProps(current.type, merged);
          if (!v.ok) throw new Error(v.error);
          return v.props;
        })()
      : current.props;

    let spec: LiminalAppSpec = {
      ...current,
      title: patch.title?.trim().slice(0, 80) || current.title,
      props: nextProps,
      refresh: patch.refresh ?? current.refresh,
      placement: patch.placement ?? current.placement,
      shell: patch.shell
        ? normalizeAppShell({ ...current.shell, ...patch.shell }, current.type)
        : current.shell,
      auto_open: patch.auto_open ?? current.auto_open,
      updated_at: Date.now(),
      source: patch.auto_open !== undefined ? "user" : current.source,
    };
    if (patch.auto_open !== undefined) spec.source = "user";

    spec = await prepareSpecPropsForStorage(spec.id, spec);
    const saved = await upsertApp(spec);
    await this.refreshApp(saved.id);
    this.sink(serverFrame("app_updated", { app: saved }));
    await this.broadcastAppList();
    return saved;
  }

  async closeApp(appId: string): Promise<boolean> {
    const ok = await removeApp(appId);
    if (!ok) return false;
    this.lastRefreshAt.delete(appId);
    this.sink(serverFrame("app_closed", { appId }));
    await this.broadcastAppList();
    return true;
  }

  async refreshApp(appId: string): Promise<AppCacheEntry> {
    const spec = await getApp(appId);
    if (!spec) throw new Error(`Unknown app id: ${appId}`);

    const entry = await this.fetchCacheForSpec(spec);
    await writeAppCache(appId, entry);
    this.lastRefreshAt.set(appId, Date.now());
    this.sink(serverFrame("app_data", { appId, cache: entry }));
    return entry;
  }

  async refreshAllDue(): Promise<void> {
    if (!this.isEnabled()) return;
    const minMs = Number(effectiveHarnessEnvRaw("AGENT_APP_REFRESH_MIN_INTERVAL_MS") ?? "300000");
    const floor = Number.isFinite(minMs) ? Math.max(60_000, minMs) : 300_000;
    const apps = await listApps();
    const now = Date.now();

    for (const app of apps) {
      const intervalMin = app.refresh?.interval_min ?? getAppTypeMeta(app.type)?.defaultRefreshMin ?? 45;
      const dueMs = intervalMin * 60_000;
      const last = this.lastRefreshAt.get(app.id) ?? 0;
      if (now - last < Math.max(floor, dueMs)) continue;
      try {
        await this.refreshApp(app.id);
      } catch {
        /* per-app */
      }
    }
  }

  async broadcastAppList(): Promise<void> {
    const payload = await this.listAppsWithCaches();
    this.sink(serverFrame("app_list", payload));
  }

  private async fetchCacheForSpec(spec: LiminalAppSpec): Promise<AppCacheEntry> {
    const fetched_at = Date.now();
    try {
      if (spec.type === "weather") {
        const location = String(spec.props["location"] ?? "").trim();
        if (!location) throw new Error("Weather app missing location prop.");
        const countryHint =
          typeof spec.props["country_hint"] === "string"
            ? spec.props["country_hint"]
            : undefined;
        const unitsRaw = spec.props["units"];
        const units =
          unitsRaw === "imperial" || unitsRaw === "metric" ? unitsRaw : "metric";
        const data = await fetchWeather({
          location,
          country_hint: countryHint,
          units,
        });
        return { fetched_at, ok: true, data };
      }

      let payload: unknown = undefined;
      const dataFetch = spec.props["data_fetch"];
      if (dataFetch && typeof dataFetch === "object") {
        const df = dataFetch as Record<string, unknown>;
        const url = String(df["url"] ?? "").trim();
        const method = String(df["method"] ?? "GET");
        if (url) payload = await fetchJsonUrl(url, method);
      }

      const partial: AppCacheEntry = {
        fetched_at,
        ok: true,
        data: payload !== undefined ? { payload } : {},
      };

      if (isHtmlCapableType(spec.type)) {
        const doc = await buildHtmlDocumentForSpec(spec, partial);
        await persistRenderedDocument(spec.id, doc);
        partial.data = {
          ...(typeof partial.data === "object" && partial.data ? partial.data : {}),
          rendered: true,
        };
      }

      return partial;
    } catch (err) {
      return {
        fetched_at,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
