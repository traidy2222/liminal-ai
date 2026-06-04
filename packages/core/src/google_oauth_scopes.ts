import {
  GOOGLE_OAUTH_SCOPES_FULL,
  type GoogleServicePreset,
  scopesForGoogleServices,
} from "./connector_catalog.js";

/** Scopes required for the given service presets (read_write). */
export function requiredScopesForPresets(presets: GoogleServicePreset[]): string[] {
  return scopesForGoogleServices(presets, "read_write");
}

/** Scopes the stored token is missing for the requested presets. */
export function missingGoogleScopes(granted: string[], presets: GoogleServicePreset[]): string[] {
  const grantedSet = new Set(granted);
  const required = requiredScopesForPresets(presets);
  return required.filter((s) => !grantedSet.has(s));
}

/** Scopes from {@link GOOGLE_OAUTH_SCOPES_FULL} not present on the token. */
export function missingDefaultWorkspaceScopes(granted: string[]): string[] {
  const grantedSet = new Set(granted);
  return GOOGLE_OAUTH_SCOPES_FULL.filter((s) => !grantedSet.has(s));
}

export function formatGoogleScopeDiagnostics(granted: string[], presets: GoogleServicePreset[]): string {
  const missing = missingGoogleScopes(granted, presets);
  if (missing.length === 0) {
    return `OAuth token has all ${requiredScopesForPresets(presets).length} scopes needed for: ${presets.map((p) => p.id).join(", ")}.`;
  }
  const serviceIds = presets.map((p) => p.id).join(", ");
  return (
    `OAuth token is missing ${missing.length} scope(s) for [${serviceIds}].\n` +
    `Missing: ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? ` (+${missing.length - 6} more)` : ""}\n` +
    `Revoke Liminal at https://myaccount.google.com/permissions then run \`liminal connect google\` again (or Settings → Integrations → Connect Google with all services selected).`
  );
}
