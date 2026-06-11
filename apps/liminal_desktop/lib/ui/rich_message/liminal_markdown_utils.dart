// Ports packages/web/client/liminalMarkdownUtils.ts
library;

const _htmlEmbedLangs = {'html', 'htm', 'xhtml'};

const _htmlVoid = {
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
};

bool isHtmlEmbedLang(String? lang) =>
    lang != null && _htmlEmbedLangs.contains(lang.toLowerCase());

String extractFencedCodeText(String raw) =>
    raw.replaceAll(RegExp(r'\n$'), '');

class StreamingHtmlFenceSplit {
  const StreamingHtmlFenceSplit({
    required this.outerMarkdown,
    required this.htmlLive,
  });

  final String outerMarkdown;
  final String? htmlLive;
}

final _htmlFenceOpenRe = RegExp(
  r'```(?:html|htm|xhtml)\s*\r?\n',
  caseSensitive: false,
);

StreamingHtmlFenceSplit extractStreamingHtmlFence(String text) {
  var lastOpenIdx = -1;
  var lastOpenLen = 0;
  for (final match in _htmlFenceOpenRe.allMatches(text)) {
    lastOpenIdx = match.start;
    lastOpenLen = match.end - match.start;
  }
  if (lastOpenIdx < 0) {
    return StreamingHtmlFenceSplit(outerMarkdown: text, htmlLive: null);
  }

  final afterOpen = text.substring(lastOpenIdx + lastOpenLen);
  final closeIdx = afterOpen.indexOf('```');
  if (closeIdx >= 0) {
    return StreamingHtmlFenceSplit(outerMarkdown: text, htmlLive: null);
  }

  return StreamingHtmlFenceSplit(
    outerMarkdown: text.substring(0, lastOpenIdx).trimRight(),
    htmlLive: afterOpen,
  );
}

String balanceHtmlForStreamingPreview(String html) {
  var s = html.trim();
  if (s.isEmpty) return '';

  final lastGt = s.lastIndexOf('>');
  final lastLt = s.lastIndexOf('<');
  if (lastLt > lastGt) {
    final trimmed = s.substring(0, lastLt).trimRight();
    s = trimmed.isEmpty ? html.trim() : trimmed;
  }
  if (s.isEmpty) return '';

  final stack = <String>[];
  final tagRe = RegExp(r'<\/?([a-zA-Z][\w:-]*)((?:\s+[^>]*)?)\s*(\/)?>');
  for (final match in tagRe.allMatches(s)) {
    final full = match.group(0)!;
    final name = match.group(1)!.toLowerCase();
    final selfClose = match.group(3) == '/' || full.endsWith('/>');
    if (selfClose || _htmlVoid.contains(name)) continue;
    if (full.startsWith('</')) {
      final idx = stack.lastIndexOf(name);
      if (idx >= 0) stack.removeRange(idx, stack.length);
    } else {
      stack.add(name);
    }
  }

  var out = s;
  for (var i = stack.length - 1; i >= 0; i--) {
    out += '</${stack[i]}>';
  }
  return out;
}

final _closedHtmlFenceRe = RegExp(
  r'```(?:html|htm|xhtml)\s*\r?\n([\s\S]*?)```',
  caseSensitive: false,
);

enum MessageSegmentKind { markdown, htmlEmbed }

class MessageSegment {
  const MessageSegment({required this.kind, required this.content});

  final MessageSegmentKind kind;
  final String content;
}

/// Split assistant text into markdown vs closed ```html``` blocks.
List<MessageSegment> splitMessageSegments(String text) {
  final segments = <MessageSegment>[];
  var cursor = 0;
  for (final match in _closedHtmlFenceRe.allMatches(text)) {
    if (match.start > cursor) {
      final md = text.substring(cursor, match.start).trim();
      if (md.isNotEmpty) {
        segments.add(MessageSegment(kind: MessageSegmentKind.markdown, content: md));
      }
    }
    final html = match.group(1)?.trim() ?? '';
    if (html.isNotEmpty) {
      segments.add(MessageSegment(kind: MessageSegmentKind.htmlEmbed, content: html));
    }
    cursor = match.end;
  }
  if (cursor < text.length) {
    final tail = text.substring(cursor).trim();
    if (tail.isNotEmpty) {
      segments.add(MessageSegment(kind: MessageSegmentKind.markdown, content: tail));
    }
  }
  if (segments.isEmpty && text.trim().isNotEmpty) {
    segments.add(MessageSegment(kind: MessageSegmentKind.markdown, content: text));
  }
  return segments;
}

bool looksLikeInlineHtmlFragment(String text) {
  final t = text.trimLeft();
  if (!t.startsWith('<')) return false;
  return RegExp(
    r'^<(div|section|article|table|p|span|h[1-6]|ul|ol|header|footer|main)\b',
    caseSensitive: false,
  ).hasMatch(t);
}
