/** Inject the loopback web auth token into the SPA shell so the client can authenticate before React mounts. */
export function injectWebAuthIntoHtml(html: string, token: string): string {
  const encoded = token
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
  const tag = `<meta name="liminal-web-auth" content="${encoded}" />`;
  if (html.includes("<head>")) {
    return html.replace("<head>", `<head>\n    ${tag}`);
  }
  return `${tag}\n${html}`;
}
