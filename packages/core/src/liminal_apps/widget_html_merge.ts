/**
 * Repair widget HTML where content was appended after a closed </html> (legacy).
 */

function findCaseInsensitive(haystack: string, needle: string): number {
  return haystack.toLowerCase().indexOf(needle.toLowerCase());
}

/** Move styles/scripts that were appended after </html> back inside <body>. */
export function repairWidgetHtmlDocument(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) return trimmed;

  const closeIdx = findCaseInsensitive(trimmed, "</html>");
  if (closeIdx < 0) return trimmed;

  const closeTagMatch = trimmed.slice(closeIdx).match(/^<\/html\s*>/i);
  const closeTag = closeTagMatch?.[0] ?? "</html>";
  const afterClose = trimmed.slice(closeIdx + closeTag.length).trim();
  if (!afterClose) return trimmed;

  const head = trimmed.slice(0, closeIdx);
  const bodyCloseIdx = findCaseInsensitive(head, "</body>");
  if (bodyCloseIdx < 0) {
    return head + afterClose + closeTag;
  }

  const bodyCloseMatch = head.slice(bodyCloseIdx).match(/^<\/body\s*>/i);
  const bodyCloseTag = bodyCloseMatch?.[0] ?? "</body>";
  return head.slice(0, bodyCloseIdx) + afterClose + head.slice(bodyCloseIdx) + closeTag;
}
