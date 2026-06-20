import {
  DEFAULT_MICROSOFT_SERVICE_IDS,
  apiScopesForMicrosoftServices,
  resolveMicrosoftServices,
  type MicrosoftServicePreset,
} from "./microsoft_connector_catalog.js";

/** Broader granted scopes that satisfy narrower required Graph scopes. */
const BROADER_SCOPE_IMPLIES: ReadonlyArray<{ broader: string; implies: readonly string[] }> = [
  {
    broader: "Mail.ReadWrite",
    implies: ["Mail.Read", "Mail.ReadBasic"],
  },
  {
    broader: "Mail.Send",
    implies: ["Mail.ReadWrite"],
  },
  {
    broader: "Calendars.ReadWrite",
    implies: ["Calendars.Read"],
  },
  {
    broader: "Files.ReadWrite.All",
    implies: ["Files.Read.All", "Files.Read"],
  },
  {
    broader: "Sites.ReadWrite.All",
    implies: ["Sites.Read.All"],
  },
  {
    broader: "Notes.ReadWrite.All",
    implies: ["Notes.Read.All"],
  },
  {
    broader: "Chat.ReadWrite",
    implies: ["Chat.Read"],
  },
  {
    broader: "Tasks.ReadWrite",
    implies: ["Tasks.Read"],
  },
  {
    broader: "Contacts.ReadWrite",
    implies: ["Contacts.Read"],
  },
];

export function normalizeMicrosoftScope(scope: string): string {
  return scope.trim();
}

export function normalizeMicrosoftScopes(scopes: string[]): string[] {
  return [...new Set(scopes.map(normalizeMicrosoftScope).filter(Boolean))];
}

function grantedIncludesScope(granted: string[], required: string): boolean {
  const normGranted = new Set(normalizeMicrosoftScopes(granted));
  const normRequired = normalizeMicrosoftScope(required);
  if (normGranted.has(normRequired)) return true;
  for (const { broader, implies } of BROADER_SCOPE_IMPLIES) {
    if (implies.includes(normRequired) && normGranted.has(broader)) return true;
  }
  if (required.endsWith(".Read") && !required.endsWith(".Read.All")) {
    const writePeer = required.replace(/\.Read$/, ".ReadWrite");
    if (normGranted.has(writePeer) || normGranted.has(`${writePeer}.All`)) return true;
  }
  return false;
}

export function requiredScopesForMicrosoftPresets(presets: MicrosoftServicePreset[]): string[] {
  return apiScopesForMicrosoftServices(presets, "read_write");
}

export function missingMicrosoftScopes(
  granted: string[],
  presets: MicrosoftServicePreset[]
): string[] {
  const required = requiredScopesForMicrosoftPresets(presets);
  return required.filter((s) => !grantedIncludesScope(granted, s));
}

export function missingDefaultMicrosoftScopes(granted: string[]): string[] {
  const required = apiScopesForMicrosoftServices(
    resolveMicrosoftServices(DEFAULT_MICROSOFT_SERVICE_IDS),
    "read_write"
  );
  return required.filter((s) => !grantedIncludesScope(granted, s));
}

export function formatMicrosoftScopeDiagnostics(
  granted: string[],
  presets: MicrosoftServicePreset[]
): string {
  const missing = missingMicrosoftScopes(granted, presets);
  if (missing.length === 0) {
    return `OAuth token has all ${requiredScopesForMicrosoftPresets(presets).length} scopes needed for: ${presets.map((p) => p.id).join(", ")}.`;
  }
  const serviceIds = presets.map((p) => p.id).join(", ");
  return (
    `OAuth token is missing ${missing.length} scope(s) for [${serviceIds}].\n` +
    `Missing: ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? ` (+${missing.length - 6} more)` : ""}\n` +
    `Revoke Liminal in Microsoft account apps (https://mysignins.microsoft.com/) then reconnect via Settings → Integrations → Microsoft 365.`
  );
}
