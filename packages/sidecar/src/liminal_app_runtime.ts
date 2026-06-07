import type { AppCacheEntry, LiminalAppSpec } from "@liminal/core";
import {
  extractHostsFromDataFetch,
  normalizeHtmlPropsForPersist,
  normalizeProxyHosts,
  resolveAppBodyHtml,
  writeAppHtml,
} from "@liminal/core";

export async function prepareSpecPropsForStorage(
  appId: string,
  spec: LiminalAppSpec
): Promise<LiminalAppSpec> {
  let props = { ...spec.props };
  if (spec.type === "html") {
    props = await normalizeHtmlPropsForPersist(appId, props, writeAppHtml);
  }
  const dataFetch = props["data_fetch"];
  if (dataFetch && typeof dataFetch === "object") {
    const url = String((dataFetch as Record<string, unknown>)["url"] ?? "");
    const hosts = extractHostsFromDataFetch(url);
    const existing = normalizeProxyHosts(props["proxy_hosts"]);
    props = { ...props, proxy_hosts: [...new Set([...existing, ...hosts])].slice(0, 8) };
  }
  return { ...spec, props };
}

export async function buildHtmlDocumentForSpec(
  spec: LiminalAppSpec,
  cache: AppCacheEntry | null
): Promise<string> {
  return resolveAppBodyHtml(spec, cache);
}

export async function persistRenderedDocument(appId: string, doc: string): Promise<void> {
  await writeAppHtml(appId, doc);
}
