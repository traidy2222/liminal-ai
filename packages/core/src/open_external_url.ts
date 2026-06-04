/**
 * Open a URL in the default browser. On Windows, avoid `cmd start` — it splits on `&`
 * and breaks OAuth URLs (drops response_type, etc.).
 */
export function openExternalUrl(url: string): void {
  void import("node:child_process").then(({ spawn }) => {
    try {
      if (process.platform === "win32") {
        spawn("rundll32", ["url.dll,FileProtocolHandler", url], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        }).unref();
        return;
      }
      if (process.platform === "darwin") {
        spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
        return;
      }
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    } catch {
      console.log(`Open this URL in your browser:\n${url}`);
    }
  });
}
