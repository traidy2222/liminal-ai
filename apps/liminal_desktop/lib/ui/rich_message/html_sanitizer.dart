import 'package:html/dom.dart' as dom;
import 'package:html/parser.dart' as html_parser;

/// Max HTML chars per embed (align with wire tool output caps).
const int kMaxEmbedHtmlChars = 120000;

const _allowedTags = {
  'a',
  'abbr',
  'b',
  'blockquote',
  'br',
  'caption',
  'code',
  'col',
  'colgroup',
  'div',
  'em',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'i',
  'iframe',
  'img',
  'li',
  'main',
  'mark',
  'ol',
  'p',
  'pre',
  'section',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
};

const _globalAttrs = {
  'class',
  'id',
  'title',
  'role',
  'aria-label',
  'aria-hidden',
  'style',
};

const _tagAttrs = <String, Set<String>>{
  'a': {'href', 'target', 'rel'},
  'img': {'src', 'alt', 'width', 'height', 'loading'},
  'iframe': {'src', 'allow', 'allowfullscreen', 'frameborder', 'title'},
  'td': {'colspan', 'rowspan'},
  'th': {'colspan', 'rowspan', 'scope'},
};

bool _isAllowedUrl(String? url) {
  if (url == null || url.trim().isEmpty) return false;
  final u = url.trim().toLowerCase();
  if (u.startsWith('javascript:') || u.startsWith('vbscript:')) return false;
  if (u.startsWith('data:')) {
    return u.startsWith('data:image/');
  }
  return u.startsWith('https://') || u.startsWith('http://');
}

bool _isAllowedIframeSrc(String? src) {
  if (!_isAllowedUrl(src)) return false;
  final u = src!.toLowerCase();
  return u.contains('youtube.com/embed/') ||
      u.contains('youtube-nocookie.com/embed/') ||
      u.contains('player.vimeo.com/video/');
}

void _sanitizeNode(dom.Node node) {
  if (node is dom.Element) {
    final tag = node.localName?.toLowerCase() ?? '';
    if (!_allowedTags.contains(tag)) {
      node.remove();
      return;
    }
    final allowed = {..._globalAttrs, ...?_tagAttrs[tag]};
    final toRemove = <String>[];
    for (final attr in node.attributes.keys) {
      final name = attr.toString().toLowerCase();
      if (name.startsWith('on')) {
        toRemove.add(attr.toString());
        continue;
      }
      if (!allowed.contains(name)) toRemove.add(attr.toString());
    }
    for (final r in toRemove) {
      node.attributes.remove(r);
    }
    if (tag == 'a') {
      final href = node.attributes['href'];
      if (!_isAllowedUrl(href)) {
        node.attributes.remove('href');
      } else {
        node.attributes['rel'] = 'noopener noreferrer';
        node.attributes['target'] = '_blank';
      }
    }
    if (tag == 'img') {
      final src = node.attributes['src'];
      if (!_isAllowedUrl(src)) node.remove();
    }
    if (tag == 'iframe') {
      final src = node.attributes['src'];
      if (!_isAllowedIframeSrc(src)) node.remove();
    }
    if (tag == 'style') {
      node.remove();
    }
  }
  final children = [...node.nodes];
  for (final child in children) {
    _sanitizeNode(child);
  }
}

/// Sanitize HTML fragment for embed (web `rehype-sanitize` parity, best-effort).
String sanitizeEmbedHtml(String html) {
  var input = html.trim();
  if (input.isEmpty) return '';
  if (input.length > kMaxEmbedHtmlChars) {
    input = input.substring(0, kMaxEmbedHtmlChars);
  }
  try {
    final doc = html_parser.parseFragment(input);
    _sanitizeNode(doc);
    final out = doc.outerHtml;
    return out.trim();
  } catch (_) {
    return '';
  }
}

String wrapHtmlDocument(String body, {required String background}) {
  return '''
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html, body { margin: 0; padding: 8px; background: $background; color: #e0e0e0; font-family: system-ui, sans-serif; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; max-width: 100%; }
  a { color: #5ecfff; }
</style>
</head>
<body>$body</body>
</html>
''';
}
