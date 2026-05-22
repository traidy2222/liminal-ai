import type { PersonaUiShell } from "@liminal/core/persona-ui-theme";
import type { ShellContract } from "../ShellContract.js";
import { HudShell } from "./HudShell.js";
import { TerminalShell } from "./TerminalShell.js";
import { StudioShell } from "./StudioShell.js";
import { MinimalShell } from "./MinimalShell.js";

export function PersonaShellSwitcher({
  shell,
  contract,
}: {
  shell: PersonaUiShell;
  contract: ShellContract;
}) {
  switch (shell) {
    case "terminal":
      return <TerminalShell contract={contract} />;
    case "studio":
      return <StudioShell contract={contract} />;
    case "minimal":
      return <MinimalShell contract={contract} />;
    case "hud":
    default:
      return <HudShell contract={contract} />;
  }
}
