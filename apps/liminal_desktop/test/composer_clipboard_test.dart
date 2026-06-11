import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:liminal_desktop/ui/widgets/composer_clipboard.dart';

void main() {
  test('attachmentFromClipboardBytes detects png magic bytes', () {
    // PNG header
    final bytes = Uint8List.fromList([
      0x89,
      0x50,
      0x4E,
      0x47,
      0x0D,
      0x0A,
      0x1A,
      0x0A,
      0,
      0,
    ]);
    final att = ComposerClipboard.attachmentFromClipboardBytes(bytes);
    expect(att.mimeType, 'image/png');
    expect(att.source, 'clipboard');
    expect(att.sizeBytes, bytes.length);
  });
}
