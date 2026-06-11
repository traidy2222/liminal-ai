import 'package:flutter_test/flutter_test.dart';
import 'package:liminal_desktop/ui/rich_message/html_sanitizer.dart';

void main() {
  test('extractEmailHtmlBodyFragment unwraps full document', () {
    const doc = '''
<!DOCTYPE html>
<html>
<head><style>p { color: red; }</style></head>
<body>
  <p style="font-weight:bold">Hello <strong>world</strong></p>
</body>
</html>
''';
    final fragment = extractEmailHtmlBodyFragment(doc);
    expect(fragment, contains('<p'));
    expect(fragment, contains('Hello'));
    expect(fragment, isNot(contains('<html')));
  });

  test('sanitizeEmailPreviewHtml keeps body markup renderable', () {
    const doc = '''
<html><body><div style="color:#333"><p>Hi there</p></div></body></html>
''';
    final clean = sanitizeEmailPreviewHtml(doc);
    expect(clean, isNotEmpty);
    expect(clean, contains('Hi there'));
    expect(clean.toLowerCase(), isNot(contains('<html')));
  });
}
