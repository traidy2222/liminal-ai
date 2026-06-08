import 'package:flutter_test/flutter_test.dart';
import 'package:liminal_desktop/core/email_copy_sanitize.dart';
import 'package:liminal_desktop/core/streaming_write_preview.dart';

void main() {
  test('repairEmailUnicode fixes Shift-JIS-style em dash mojibake', () {
    const bad = 'hope the experience \u{ffe2}\u{ff80}\u{ff94} and the team';
    expect(
      repairEmailUnicode(bad),
      'hope the experience \u{2014} and the team',
    );
  });

  test('humanizeOutboundEmailCopy replaces em dashes with commas', () {
    expect(
      humanizeOutboundEmailCopy('hope the experience \u{2014} and the team'),
      'hope the experience, and the team',
    );
  });

  test('sanitizeEmailPreviewCopy repairs then humanizes', () {
    const bad = 'Line \u{ffe2}\u{ff80}\u{ff94} end';
    expect(sanitizeEmailPreviewCopy(bad), 'Line, end');
  });

  test('extractEmailStreamPreview sanitizes body for preview', () {
    const args = '''
{"to":["a@b.com"],"subject":"Hi","body":"Staff hours \u{ffe2}\u{ff80}\u{ff94} saved"}
''';
    final preview = extractEmailStreamPreview('gmail_create_draft', args);
    expect(preview.bodyPlain, 'Staff hours, saved');
  });
}
