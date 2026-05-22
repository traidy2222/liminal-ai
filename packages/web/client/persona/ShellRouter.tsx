import type { ReactNode } from "react";
import {
  migratePersonaUiTheme,
  shellRootClassName,
  type PersonaUiThemeV2,
} from "@liminal/core/persona-ui-theme";
import { buildShellRootStyle } from "./shellLayout.js";

export interface ShellRouterProps {
  theme: PersonaUiThemeV2 | null;
  children: ReactNode;
}

/** Applies shell-specific root layout class + inline tokens for the active persona. */
export function ShellRouter({ theme, children }: ShellRouterProps) {
  const t = migratePersonaUiTheme(theme);
  return (
    <div className={shellRootClassName(t.shell)} style={buildShellRootStyle(theme)}>
      {children}
    </div>
  );
}
