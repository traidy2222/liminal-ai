import type { ReactNode } from "react";
import type { PersonaUiShell } from "@liminal/core/persona-ui-theme";
import { buildShellBodyStyle } from "../shellLayout.js";

export function ShellBody({ shell, children }: { shell: PersonaUiShell; children: ReactNode }) {
  return <div style={buildShellBodyStyle(shell)}>{children}</div>;
}
