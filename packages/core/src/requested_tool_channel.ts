/** Tool-channel preference controls preloading only; every family remains discoverable. */
export function browserChannelRequested(text: string): boolean {
  const instruction = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/"(?:\\.|[^"\\])*"/g, " ");
  const browser =
    /\b(?:use|using|via|through|with)\b[^.\n]{0,50}\bbrowser\b|\bbrowser_(?:open|act|navigate|snapshot|extract)\b/i.test(
      instruction,
    );
  const negated =
    /\b(?:do not|don't|never|avoid)\s+(?:use\s+)?(?:the\s+|a\s+)?browser\b/i.test(
      instruction,
    );
  const connector =
    /\b(?:use|using|via|through|with)\b[^.\n]{0,35}\b(?:mcp|rest|connector|integration)\b|\b(?:mcp_|gmail_|outlook_)\w+/i.test(
      instruction,
    );
  return browser && !negated && !connector;
}
