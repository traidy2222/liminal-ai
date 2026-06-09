/**
 * Integration OAuth recovery — shared between tools error strings and harness dispatcher.
 */

export const CONNECTORS_FAMILY_ID = "connectors";

const NOT_CONNECTED_RE = / not connected\. Call connect_provider\(\{ provider: "([^"]+)"/;

/** Parse provider id from integrationNotConnectedError() text. */
export function parseIntegrationNotConnectedProvider(error: string | undefined): string | null {
  if (!error?.trim()) return null;
  const m = error.match(NOT_CONNECTED_RE);
  return m?.[1]?.trim() || null;
}
