import type { FitAddon, Terminal } from "ghostty-web";

export interface TerminalFitHandle {
  /** Fit terminal to container; returns cols/rows when dimensions changed. */
  fit: () => { cols: number; rows: number } | null;
  dispose: () => void;
}

/** Ghostty FitAddon + debounced resize observers (container + window). */
export function installTerminalFit(
  term: Terminal,
  FitAddonCtor: typeof FitAddon,
  onDimensions?: (cols: number, rows: number) => void
): TerminalFitHandle {
  const fitAddon = new FitAddonCtor();
  term.loadAddon(fitAddon);

  let lastCols = 0;
  let lastRows = 0;
  let debounce: ReturnType<typeof setTimeout> | undefined;

  const fit = (): { cols: number; rows: number } | null => {
    const dims = fitAddon.proposeDimensions();
    if (!dims) return null;
    const { cols, rows } = dims;
    if (cols === lastCols && rows === lastRows) return null;
    lastCols = cols;
    lastRows = rows;
    fitAddon.fit();
    onDimensions?.(cols, rows);
    return { cols, rows };
  };

  const schedule = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      fit();
    }, 80);
  };

  window.addEventListener("resize", schedule);
  fitAddon.observeResize();

  return {
    fit,
    dispose: () => {
      if (debounce) clearTimeout(debounce);
      window.removeEventListener("resize", schedule);
      fitAddon.dispose();
    },
  };
}

/** Wait until the host has measurable layout before the first fit. */
export async function waitForTerminalHost(host: HTMLElement): Promise<void> {
  await new Promise<void>((resolve) => {
    const tick = () => {
      if (host.clientWidth >= 40 && host.clientHeight >= 40) {
        resolve();
        return;
      }
      setTimeout(tick, 40);
    };
    tick();
  });
}
