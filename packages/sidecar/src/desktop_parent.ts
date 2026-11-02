/** A desktop-owned sidecar must not outlive its UI and lock the install folder. */
export function watchDesktopParent(parentPid: number, onExit: () => void): () => void {
  // Only monitor our actual launching process. Standalone/attached servers opt out.
  if (!Number.isSafeInteger(parentPid) || parentPid <= 1 || parentPid !== process.ppid) return () => {};
  const timer = setInterval(() => {
    try { process.kill(parentPid, 0); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return;
      clearInterval(timer);
      onExit();
    }
  }, 500);
  timer.unref();
  return () => clearInterval(timer);
}
