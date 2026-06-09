/**
 * Lazy-loading helpers shared by dispatcher and tool catalog (core-only).
 */

/** Auto-activate only this tool on miss — never the whole mapped family. */
export const LAZY_AUTO_ACTIVATE_TOOL_ONLY = new Set<string>(["email_style_infer"]);
