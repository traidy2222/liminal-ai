import { lookup } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { Agent } from 'undici';
import { guardToolArgs } from '@liminal/core';

function assertPublicUrl(url: URL): void {
  const reason = guardToolArgs('web_fetch', { url: url.href });
  if (reason) throw new Error(reason);
}

// Validate the addresses returned to the socket itself. A separate preflight DNS
// check followed by an ordinary fetch would allow DNS rebinding between lookups.
const publicLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) { callback(error, '', 0); return; }
    try {
      if (!addresses.length) throw new Error('No public destination addresses');
      for (const { address, family } of addresses) {
        assertPublicUrl(new URL(`http://${family === 6 ? `[${address}]` : address}/`));
      }
      const family = Number(options.family) || 0;
      const candidates = addresses.filter(address => !family || address.family === family);
      if (!candidates.length) throw new Error('No destination address for the requested family');
      if (options.all) callback(null, candidates);
      else callback(null, candidates[0]!.address, candidates[0]!.family);
    } catch (err) { callback(err instanceof Error ? err : new Error(String(err)), '', 0); }
  });
};
const publicAgent = new Agent({ connect: { lookup: publicLookup }, maxRedirections: 0 });

/** Public-page GET/HEAD transport; integrations and explicit http_request keep their own policy. */
export const publicWebFetch: typeof fetch = async (input, init = {}) => {
  let url = new URL(input instanceof Request ? input.url : String(input));
  const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') throw new Error('Public page transport only supports GET/HEAD');
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.delete('host');
  for (let hop = 0; hop <= 5; hop++) {
    init.signal?.throwIfAborted();
    assertPublicUrl(url);
    const response = await fetch(url, {
      ...init, method, headers, redirect: 'manual', dispatcher: publicAgent,
    } as RequestInit & { dispatcher: Agent });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    await response.body?.cancel();
    if (hop === 5) throw new Error('Public page redirect limit exceeded');
    const next = new URL(location, url);
    if (next.origin !== url.origin) {
      for (const name of ['authorization', 'proxy-authorization', 'cookie']) headers.delete(name);
    }
    url = next;
  }
  throw new Error('Public page redirect limit exceeded');
};
