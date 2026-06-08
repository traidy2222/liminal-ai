import 'dart:convert';

/// Repair mojibake and de-AI punctuation for live email preview (parity with
/// `@liminal/tools` gmail_message_body repair + humanize on send).

int _countEmailMojibakeMarkers(String text) {
  final re = RegExp(r'\u{ffe2}\u{ff80}|\u{e2}\u{80}|\u{e2}\u{20ac}|Ã.|Â.');
  return re.allMatches(text).length;
}

/// Fix UTF-8 punctuation misread as Latin-1 / Shift-JIS (e.g. ￢ﾀﾔ → —).
String repairEmailUnicode(String text) {
  if (text.isEmpty || !RegExp(r'[^\x00-\x7f]').hasMatch(text)) return text;

  var s = text;

  const fullwidth = <(String, String)>[
    ('\u{ffe2}\u{ff80}\u{ff94}', '\u{2014}'),
    ('\u{ffe2}\u{ff80}\u{ff93}', '\u{2013}'),
    ('\u{ffe2}\u{ff80}\u{ff99}', '\u{2019}'),
    ('\u{ffe2}\u{ff80}\u{ff98}', '\u{2018}'),
    ('\u{ffe2}\u{ff80}\u{ff9c}', '\u{201c}'),
    ('\u{ffe2}\u{ff80}\u{ff9d}', '\u{201d}'),
    ('\u{ffe2}\u{ff80}\u{ff9a}', '\u{2026}'),
  ];
  for (final (bad, good) in fullwidth) {
    s = s.replaceAll(bad, good);
  }

  const misreadUtf8 = <(String, String)>[
    ('\u{e2}\u{80}\u{94}', '\u{2014}'),
    ('\u{e2}\u{80}\u{93}', '\u{2013}'),
    ('\u{e2}\u{80}\u{99}', '\u{2019}'),
    ('\u{e2}\u{80}\u{98}', '\u{2018}'),
    ('\u{e2}\u{80}\u{9c}', '\u{201c}'),
    ('\u{e2}\u{80}\u{9d}', '\u{201d}'),
    ('\u{e2}\u{80}\u{a6}', '\u{2026}'),
    ('\u{e2}\u{20ac}\u{201d}', '\u{2014}'),
    ('\u{e2}\u{20ac}\u{201c}', '\u{2013}'),
    ('\u{e2}\u{20ac}\u{2122}', '\u{2019}'),
    ('\u{e2}\u{20ac}\u{02dc}', '\u{2018}'),
    ('\u{e2}\u{20ac}\u{0153}', '\u{201c}'),
    ('\u{e2}\u{20ac}\u{009d}', '\u{201d}'),
    ('\u{e2}\u{20ac}\u{00a6}', '\u{2026}'),
  ];
  for (final (bad, good) in misreadUtf8) {
    s = s.replaceAll(bad, good);
  }

  s = s.replaceAll('\u{c2}\u{a0}', '\u{a0}');

  if (_countEmailMojibakeMarkers(s) > 0) {
    try {
      final bytes = latin1.encode(s);
      final recovered = utf8.decode(bytes, allowMalformed: true);
      if (recovered.isNotEmpty &&
          !recovered.contains('\u{fffd}') &&
          _countEmailMojibakeMarkers(recovered) < _countEmailMojibakeMarkers(s)) {
        s = recovered;
      }
    } catch (_) {
      // keep s
    }
  }

  return s;
}

/// Replace em/en dashes with commas (R-EMAIL-COPY; matches outbound send path).
String humanizeOutboundEmailCopy(String text) {
  if (text.isEmpty) return text;
  var s = text
      .replaceAll(RegExp(r'&mdash;|&#0*8212;|&#x0*2014;', caseSensitive: false), ', ')
      .replaceAll(RegExp(r'&ndash;|&#0*8211;|&#x0*2013;', caseSensitive: false), ', ')
      .replaceAll(RegExp(r'\s*[\u2014\u2013]\s*'), ', ')
      .replaceAll(RegExp(r'([,.;])\s*,'), r'$1')
      .replaceAll(RegExp(r',\s*([.!?])'), r'$1');
  s = s.replaceAll(RegExp(r' {2,}'), ' ');
  return s;
}

String sanitizeEmailPreviewCopy(String? text) {
  if (text == null || text.isEmpty) return text ?? '';
  return humanizeOutboundEmailCopy(repairEmailUnicode(text));
}
