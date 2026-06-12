import {
  GOOGLE_WORKSPACE_SERVICES,
  apiScopesForGoogleServices,
  type GoogleServicePreset,
} from "./connector_catalog.js";

const SCOPE_EQUIVALENTS: Record<string, readonly string[]> = {
  email: ["email", "https://www.googleapis.com/auth/userinfo.email"],
  profile: ["profile", "https://www.googleapis.com/auth/userinfo.profile"],
  openid: ["openid"],
};

/** Broader granted scopes that satisfy narrower required API scopes (Google often returns these). */
const BROADER_SCOPE_IMPLIES: ReadonlyArray<{ broader: string; implies: readonly string[] }> = [
  {
    broader: "https://www.googleapis.com/auth/calendar",
    implies: [
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      "https://www.googleapis.com/auth/calendar.events.freebusy",
      "https://www.googleapis.com/auth/calendar.events.readonly",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.readonly",
    ],
  },
  {
    broader: "https://www.googleapis.com/auth/calendar.events",
    implies: ["https://www.googleapis.com/auth/calendar.events.readonly"],
  },
  {
    broader: "https://www.googleapis.com/auth/drive",
    implies: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive.file",
    ],
  },
  {
    broader: "https://www.googleapis.com/auth/gmail.modify",
    implies: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.compose",
    ],
  },
  {
    broader: "https://www.googleapis.com/auth/documents",
    implies: ["https://www.googleapis.com/auth/documents.readonly"],
  },
  {
    broader: "https://www.googleapis.com/auth/spreadsheets",
    implies: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  },
  {
    broader: "https://www.googleapis.com/auth/presentations",
    implies: ["https://www.googleapis.com/auth/presentations.readonly"],
  },
  {
    broader: "https://www.googleapis.com/auth/contacts",
    implies: ["https://www.googleapis.com/auth/contacts.readonly"],
  },
  {
    broader: "https://www.googleapis.com/auth/tasks",
    implies: ["https://www.googleapis.com/auth/tasks.readonly"],
  },
  {
    broader: "https://www.googleapis.com/auth/analytics.edit",
    implies: ["https://www.googleapis.com/auth/analytics.readonly"],
  },
  {
    broader: "https://www.googleapis.com/auth/webmasters",
    implies: ["https://www.googleapis.com/auth/webmasters.readonly"],
  },
];

/** Normalize Google-returned scope strings to short OIDC names where applicable. */
export function normalizeGoogleScope(scope: string): string {
  const s = scope.trim();
  if (s === "https://www.googleapis.com/auth/userinfo.email") return "email";
  if (s === "https://www.googleapis.com/auth/userinfo.profile") return "profile";
  return s;
}

export function normalizeGoogleScopes(scopes: string[]): string[] {
  return [...new Set(scopes.map(normalizeGoogleScope).filter(Boolean))];
}

function grantedIncludesScope(granted: string[], required: string): boolean {
  const normGranted = new Set(normalizeGoogleScopes(granted));
  const normRequired = normalizeGoogleScope(required);
  const aliases = SCOPE_EQUIVALENTS[normRequired];
  if (aliases?.some((a) => normGranted.has(normalizeGoogleScope(a)))) return true;
  if (normGranted.has(normRequired)) return true;
  for (const { broader, implies } of BROADER_SCOPE_IMPLIES) {
    if (implies.includes(required) && normGranted.has(normalizeGoogleScope(broader))) return true;
  }
  if (required.endsWith(".readonly")) {
    const writePeer = required.replace(/\.readonly$/, "");
    if (normGranted.has(normalizeGoogleScope(writePeer))) return true;
  }
  return false;
}

/** API scopes required for the given service presets (read_write). */
export function requiredScopesForPresets(presets: GoogleServicePreset[]): string[] {
  return apiScopesForGoogleServices(presets, "read_write");
}

/** Scopes the stored token is missing for the requested presets. */
export function missingGoogleScopes(granted: string[], presets: GoogleServicePreset[]): string[] {
  const required = requiredScopesForPresets(presets);
  return required.filter((s) => !grantedIncludesScope(granted, s));
}

/** API scopes from the full workspace catalog not present on the token. */
export function missingDefaultWorkspaceScopes(granted: string[]): string[] {
  const required = apiScopesForGoogleServices(GOOGLE_WORKSPACE_SERVICES, "read_write");
  return required.filter((s) => !grantedIncludesScope(granted, s));
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
