import { Suspense, lazy, type ReactNode } from "react";
import type { PersonaUiShell } from "@liminal/core/persona-ui-theme";
import type { ShellContract } from "../ShellContract.js";

const TerminalShell = lazy(() =>
  import("./TerminalShell.js").then((m) => ({ default: m.TerminalShell })),
);
const StudioShell = lazy(() =>
  import("./StudioShell.js").then((m) => ({ default: m.StudioShell })),
);
const MinimalShell = lazy(() =>
  import("./MinimalShell.js").then((m) => ({ default: m.MinimalShell })),
);
const HudShell = lazy(() => import("./HudShell.js").then((m) => ({ default: m.HudShell })));

function ShellLoadFallback() {
  return <div aria-busy="true" style={{ flex: 1, minHeight: 0, width: "100%" }} />;
}

function shellBody(shell: PersonaUiShell, contract: ShellContract): ReactNode {
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

export function PersonaShellSwitcher({
  shell,
  contract,
}: {
  shell: PersonaUiShell;
  contract: ShellContract;
}) {
  return <Suspense fallback={<ShellLoadFallback />}>{shellBody(shell, contract)}</Suspense>;
}
